-- Build 101 — the employer's share of SSS (with EC), PhilHealth and Pag-IBIG in payroll and the ledger.
--   * per-store contribution rates (editable; defaults are the 2025 schedules — have the accountant confirm them):
--       SSS 15% of the monthly salary credit (employee 5%, employer 10%), credit ₱5,000–₱35,000 in ₱500 steps;
--       EC (employer) ₱10 below a ₱15,000 credit, ₱30 from it; PhilHealth 5% of basic pay (floor ₱10,000, ceiling ₱100,000),
--       shared equally; Pag-IBIG 2% employee (1% up to ₱1,500) and 2% employer, on pay up to ₱10,000.
--   * "Compute contributions" fills both shares for a draft run (monthly amounts × the period's share of a month:
--     monthly 1, semi-monthly ½, weekly 12/52, daily 1/26); every amount stays editable per employee.
--   * payroll approved: Dr 5120 Employer Contributions, Cr 2101 SSS (+EC) / 2102 PhilHealth / 2103 Pag-IBIG for the employer's share,
--     next to the employee entries; remitting clears both shares.

alter table public.payroll_entries add column if not exists er_sss numeric(14,2) not null default 0;
alter table public.payroll_entries add column if not exists er_ec numeric(14,2) not null default 0;
alter table public.payroll_entries add column if not exists er_philhealth numeric(14,2) not null default 0;
alter table public.payroll_entries add column if not exists er_pagibig numeric(14,2) not null default 0;

create table if not exists public.payroll_contribution_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  sss_ee_pct numeric(7,4) not null default 5, sss_er_pct numeric(7,4) not null default 10,
  sss_msc_min numeric(14,2) not null default 5000, sss_msc_max numeric(14,2) not null default 35000, sss_msc_step numeric(14,2) not null default 500,
  sss_ec_low numeric(14,2) not null default 10, sss_ec_high numeric(14,2) not null default 30, sss_ec_threshold numeric(14,2) not null default 15000,
  ph_pct numeric(7,4) not null default 5, ph_floor numeric(14,2) not null default 10000, ph_ceiling numeric(14,2) not null default 100000,
  hdmf_ee_pct numeric(7,4) not null default 2, hdmf_er_pct numeric(7,4) not null default 2, hdmf_cap numeric(14,2) not null default 10000,
  hdmf_low_ee_pct numeric(7,4) not null default 1, hdmf_low_threshold numeric(14,2) not null default 1500,
  updated_by uuid references public.users(id), updated_at timestamptz not null default now()
);
alter table public.payroll_contribution_settings enable row level security;
drop policy if exists payroll_contribution_settings_read on public.payroll_contribution_settings;
create policy payroll_contribution_settings_read on public.payroll_contribution_settings for select
  using (public.is_super_admin() or business_id = public.current_business_id());
grant select on public.payroll_contribution_settings to authenticated;

-- monthly shares for a monthly basic pay
create or replace function public.payroll_contribution_shares(p_business uuid, p_monthly numeric)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare s public.payroll_contribution_settings; v_msc numeric; v_ph numeric; v_hd numeric;
begin
  select * into s from public.payroll_contribution_settings where business_id = p_business;
  if not found then insert into public.payroll_contribution_settings(business_id) values (p_business) on conflict do nothing;
    select * into s from public.payroll_contribution_settings where business_id = p_business; end if;
  if coalesce(p_monthly, 0) <= 0 then return jsonb_build_object('sss_ee', 0, 'sss_er', 0, 'ec', 0, 'ph_ee', 0, 'ph_er', 0, 'hdmf_ee', 0, 'hdmf_er', 0, 'msc', 0); end if;
  v_msc := least(s.sss_msc_max, greatest(s.sss_msc_min, round(p_monthly / s.sss_msc_step) * s.sss_msc_step));
  v_ph := least(s.ph_ceiling, greatest(s.ph_floor, p_monthly)) * s.ph_pct / 100;
  v_hd := least(p_monthly, s.hdmf_cap);
  return jsonb_build_object('msc', v_msc,
    'sss_ee', round(v_msc * s.sss_ee_pct / 100, 2), 'sss_er', round(v_msc * s.sss_er_pct / 100, 2),
    'ec', case when v_msc < s.sss_ec_threshold then s.sss_ec_low else s.sss_ec_high end,
    'ph_ee', round(v_ph / 2, 2), 'ph_er', round(v_ph - round(v_ph / 2, 2), 2),
    'hdmf_ee', round(v_hd * case when p_monthly <= s.hdmf_low_threshold then s.hdmf_low_ee_pct else s.hdmf_ee_pct end / 100, 2),
    'hdmf_er', round(v_hd * s.hdmf_er_pct / 100, 2));
end $$;
revoke all on function public.payroll_contribution_shares(uuid, numeric) from public;
grant execute on function public.payroll_contribution_shares(uuid, numeric) to authenticated;

-- fill both shares for every employee of a draft run
create or replace function public.payroll_compute_contributions(p_run uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; e record; prof record; v_factor numeric; v_monthly numeric; sh jsonb; n int := 0; v_ded numeric;
begin
  select pr.*, pp.frequency::text as freq into r from public.payroll_runs pr join public.payroll_periods pp on pp.id = pr.period_id where pr.id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not (public.is_super_admin() or (r.business_id = public.current_business_id() and (public.is_business_admin() or public.has_section_access('finance')))) then
    raise exception 'Finance access is required.';
  end if;
  if r.status::text <> 'draft' then raise exception 'Contributions can be computed only on a draft payroll run.'; end if;
  v_factor := case r.freq when 'semi_monthly' then 0.5 when 'weekly' then 12.0 / 52 when 'daily' then 1.0 / 26 else 1 end;
  for e in select * from public.payroll_entries where payroll_run_id = p_run loop
    select * into prof from public.payroll_employee_profiles where employee_id = e.employee_id and active order by effective_from desc nulls last limit 1;
    v_monthly := case when prof.compensation_type::text = 'monthly' then prof.base_rate
                      when prof.compensation_type::text = 'daily' then prof.base_rate * 26
                      when prof.compensation_type::text = 'hourly' then prof.base_rate * 8 * 26
                      else e.base_pay / v_factor end;
    sh := public.payroll_contribution_shares(r.business_id, coalesce(v_monthly, e.base_pay / v_factor));
    v_ded := coalesce(e.tax_withheld, 0) + round((sh->>'sss_ee')::numeric * v_factor, 2) + round((sh->>'ph_ee')::numeric * v_factor, 2)
             + round((sh->>'hdmf_ee')::numeric * v_factor, 2) + coalesce(e.other_deductions, 0);
    update public.payroll_entries set
      social_security = round((sh->>'sss_ee')::numeric * v_factor, 2), health_contribution = round((sh->>'ph_ee')::numeric * v_factor, 2),
      housing_fund = round((sh->>'hdmf_ee')::numeric * v_factor, 2),
      er_sss = round((sh->>'sss_er')::numeric * v_factor, 2), er_ec = round((sh->>'ec')::numeric * v_factor, 2),
      er_philhealth = round((sh->>'ph_er')::numeric * v_factor, 2), er_pagibig = round((sh->>'hdmf_er')::numeric * v_factor, 2),
      total_deductions = v_ded, net_pay = gross_pay - v_ded, updated_at = now()
     where id = e.id;
    n := n + 1;
  end loop;
  perform public.recalculate_payroll_run_totals(p_run);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'payroll_runs', p_run, 'contributions_computed', jsonb_build_object('entries', n));
  return n;
end $$;
revoke all on function public.payroll_compute_contributions(uuid) from public;
grant execute on function public.payroll_compute_contributions(uuid) to authenticated;

create or replace function public.payroll_contribution_settings_save(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  if not (public.is_super_admin() or public.is_business_admin() or public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver')) then
    raise exception 'A Finance approver or the Business Admin sets the contribution rates.';
  end if;
  insert into public.payroll_contribution_settings(business_id) values (b) on conflict do nothing;
  update public.payroll_contribution_settings set
    sss_ee_pct = coalesce((p->>'sss_ee_pct')::numeric, sss_ee_pct), sss_er_pct = coalesce((p->>'sss_er_pct')::numeric, sss_er_pct),
    sss_msc_min = coalesce((p->>'sss_msc_min')::numeric, sss_msc_min), sss_msc_max = coalesce((p->>'sss_msc_max')::numeric, sss_msc_max),
    sss_msc_step = coalesce(nullif((p->>'sss_msc_step')::numeric, 0), sss_msc_step),
    sss_ec_low = coalesce((p->>'sss_ec_low')::numeric, sss_ec_low), sss_ec_high = coalesce((p->>'sss_ec_high')::numeric, sss_ec_high),
    sss_ec_threshold = coalesce((p->>'sss_ec_threshold')::numeric, sss_ec_threshold),
    ph_pct = coalesce((p->>'ph_pct')::numeric, ph_pct), ph_floor = coalesce((p->>'ph_floor')::numeric, ph_floor), ph_ceiling = coalesce((p->>'ph_ceiling')::numeric, ph_ceiling),
    hdmf_ee_pct = coalesce((p->>'hdmf_ee_pct')::numeric, hdmf_ee_pct), hdmf_er_pct = coalesce((p->>'hdmf_er_pct')::numeric, hdmf_er_pct),
    hdmf_cap = coalesce((p->>'hdmf_cap')::numeric, hdmf_cap), hdmf_low_ee_pct = coalesce((p->>'hdmf_low_ee_pct')::numeric, hdmf_low_ee_pct),
    hdmf_low_threshold = coalesce((p->>'hdmf_low_threshold')::numeric, hdmf_low_threshold), updated_by = auth.uid(), updated_at = now()
   where business_id = b;
end $$;
revoke all on function public.payroll_contribution_settings_save(jsonb) from public;
grant execute on function public.payroll_contribution_settings_save(jsonb) to authenticated;

-- ledger: the employer's share next to the employee's
create or replace function public.fin_ensure_accounts_er(p_business uuid) returns void language sql security definer set search_path = public as $$
  insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
  select p_business, '5120', 'Employer Contributions', 'expense'::public.finance_account_type, 'Employer share of SSS (with EC), PhilHealth and Pag-IBIG'
   where not exists (select 1 from public.finance_chart_of_accounts where business_id = p_business and account_code = '5120');
$$;
revoke all on function public.fin_ensure_accounts_er(uuid) from public;
do $$ declare b uuid; begin for b in select id from public.businesses loop perform public.fin_ensure_accounts_er(b); end loop; end $$;

create or replace function public.fin_payroll_lines(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t record;
begin
  perform public.fin_ensure_accounts_er((select business_id from public.payroll_runs where id = p_run));
  select round(coalesce(sum(gross_pay), 0), 2) g, round(coalesce(sum(social_security), 0), 2) sss, round(coalesce(sum(health_contribution), 0), 2) ph,
         round(coalesce(sum(housing_fund), 0), 2) hd, round(coalesce(sum(tax_withheld), 0), 2) tax, round(coalesce(sum(other_deductions), 0), 2) oth,
         round(coalesce(sum(er_sss + er_ec), 0), 2) er_sss, round(coalesce(sum(er_philhealth), 0), 2) er_ph, round(coalesce(sum(er_pagibig), 0), 2) er_hd
    into t from public.payroll_entries where payroll_run_id = p_run;
  return jsonb_build_array(
    jsonb_build_object('code', '5100', 'debit', t.g, 'text', 'Gross pay'),
    jsonb_build_object('code', '5120', 'debit', t.er_sss + t.er_ph + t.er_hd, 'text', 'Employer SSS / EC, PhilHealth, Pag-IBIG'),
    jsonb_build_object('code', '2101', 'credit', t.sss + t.er_sss, 'text', 'SSS — employee ₱' || t.sss || ' + employer ₱' || t.er_sss),
    jsonb_build_object('code', '2102', 'credit', t.ph + t.er_ph, 'text', 'PhilHealth — employee ₱' || t.ph || ' + employer ₱' || t.er_ph),
    jsonb_build_object('code', '2103', 'credit', t.hd + t.er_hd, 'text', 'Pag-IBIG — employee ₱' || t.hd || ' + employer ₱' || t.er_hd),
    jsonb_build_object('code', '2104', 'credit', t.tax, 'text', 'Tax withheld'),
    jsonb_build_object('code', '2100', 'credit', t.oth, 'text', 'Other deductions'),
    jsonb_build_object('code', '2105', 'credit', t.g - t.sss - t.ph - t.hd - t.tax - t.oth, 'text', 'Net pay due'));
end $$;
revoke all on function public.fin_payroll_lines(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.fin_payroll_lines(uuid) from authenticated; revoke all on function public.fin_ensure_accounts_er(uuid) from authenticated;
  end if;
end $$;

-- the acting store's rates (creates the default row on first look)
create or replace function public.payroll_contribution_settings_get()
returns jsonb language plpgsql security definer set search_path = public as $$
declare b uuid := public.pricing_business_id(); v jsonb;
begin
  if b is null then return null; end if;
  insert into public.payroll_contribution_settings(business_id) values (b) on conflict do nothing;
  select to_jsonb(s) - 'business_id' - 'updated_by' into v from public.payroll_contribution_settings s where business_id = b;
  return v;
end $$;
revoke all on function public.payroll_contribution_settings_get() from public;
grant execute on function public.payroll_contribution_settings_get() to authenticated;
