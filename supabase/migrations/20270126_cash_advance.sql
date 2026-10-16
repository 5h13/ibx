-- Build 126 — Employee cash advance (UIA-44).
-- Employee requests in My Profile → Business Admin approves (≤ half a month's pay, ≤ 12 payments,
-- one open advance at a time, no interest) → Finance releases the cash (Dr 1330 Advances to
-- Employees, Cr cash / bank) → each payroll run deducts the instalment (Cr 1330 in the payroll
-- entry) until paid; an employee who has separated has the whole balance taken from final pay.
-- Employees only (agents are not given advances).

-- ------------------------------------------------------------------ accounts --
create or replace function public.fin_ensure_accounts_ca(p_business uuid) returns void language sql security definer set search_path = public as $$
  insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
  select p_business, '1330', 'Advances to Employees', 'asset'::public.finance_account_type, 'Cash advances released to employees, recovered through payroll'
   where not exists (select 1 from public.finance_chart_of_accounts where business_id = p_business and account_code = '1330');
$$;
revoke all on function public.fin_ensure_accounts_ca(uuid) from public;
do $$ declare b uuid; begin for b in select id from public.businesses loop perform public.fin_ensure_accounts_ca(b); end loop; end $$;

-- -------------------------------------------------------------------- tables --
create table if not exists public.employee_cash_advances (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  advance_number text,
  employee_id uuid not null references public.employees(id),
  amount numeric(14,2) not null check (amount > 0),
  payments int not null check (payments between 1 and 12),
  instalment numeric(14,2) not null,
  reason text not null,
  monthly_pay numeric(14,2),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled', 'released')),
  requested_by uuid references public.users(id),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.users(id),
  decided_at timestamptz,
  rejection_reason text,
  released_by uuid references public.users(id),
  released_at timestamptz,
  release_bank_account_id uuid references public.finance_bank_accounts(id),
  release_journal_id uuid references public.finance_journal_entries(id),
  created_at timestamptz not null default now()
);
create index if not exists employee_cash_advances_emp on public.employee_cash_advances(employee_id, status);
create or replace function public.employee_is_me(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = p_employee and user_id = auth.uid());
$$;
revoke all on function public.employee_is_me(uuid) from public;
grant execute on function public.employee_is_me(uuid) to authenticated;
alter table public.employee_cash_advances enable row level security;
drop policy if exists employee_cash_advances_read on public.employee_cash_advances;
create policy employee_cash_advances_read on public.employee_cash_advances for select using (
  (public.is_super_admin() or business_id = public.current_business_id())
  and (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')
       or public.employee_is_me(employee_id)));
grant select on public.employee_cash_advances to authenticated;

alter table public.payroll_entries add column if not exists cash_advance numeric(14,2) not null default 0;

create table if not exists public.employee_cash_advance_deductions (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.employee_cash_advances(id) on delete cascade,
  payroll_run_id uuid not null references public.payroll_runs(id) on delete cascade,
  payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (advance_id, payroll_run_id)
);
alter table public.employee_cash_advance_deductions enable row level security;
drop policy if exists employee_cash_advance_deductions_read on public.employee_cash_advance_deductions;
create policy employee_cash_advance_deductions_read on public.employee_cash_advance_deductions for select using (
  exists (select 1 from public.employee_cash_advances a where a.id = advance_id));
grant select on public.employee_cash_advance_deductions to authenticated;

-- ------------------------------------------------------------------- helpers --
-- One month's pay from the employee's active payroll profile (daily × 26, hourly × 8 × 26).
create or replace function public.cash_advance_monthly_pay(p_employee uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select case p.compensation_type::text when 'monthly' then p.base_rate when 'daily' then p.base_rate * 26
                                        when 'hourly' then p.base_rate * 8 * 26 else null end
    from public.payroll_employee_profiles p
   where p.employee_id = p_employee and p.active order by p.effective_from desc nulls last limit 1;
$$;
revoke all on function public.cash_advance_monthly_pay(uuid) from public;

-- Deducted so far: every deduction on a payroll run that is not voided.
create or replace function public.cash_advance_deducted(p_advance uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(d.amount), 0) from public.employee_cash_advance_deductions d join public.payroll_runs r on r.id = d.payroll_run_id
   where d.advance_id = p_advance and r.status::text <> 'voided';
$$;
revoke all on function public.cash_advance_deducted(uuid) from public;

create or replace function public.cash_advance_json(a public.employee_cash_advances)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(a) || jsonb_build_object(
    'employee_name', (select coalesce(e.preferred_name, e.first_name || ' ' || e.last_name) from public.employees e where e.id = a.employee_id),
    'employee_no', (select e.employee_no from public.employees e where e.id = a.employee_id),
    'deducted', public.cash_advance_deducted(a.id),
    'balance', case when a.status = 'released' then a.amount - public.cash_advance_deducted(a.id) else null end,
    'payments_made', (select count(*) from public.employee_cash_advance_deductions d join public.payroll_runs r on r.id = d.payroll_run_id
                       where d.advance_id = a.id and r.status::text <> 'voided'),
    'paid_off', a.status = 'released' and a.amount - public.cash_advance_deducted(a.id) <= 0
                and not exists (select 1 from public.employee_cash_advance_deductions d join public.payroll_runs r on r.id = d.payroll_run_id
                                 where d.advance_id = a.id and r.status::text not in ('approved', 'posted', 'voided')),
    'deductions', coalesce((select jsonb_agg(jsonb_build_object('run', r.run_number, 'status', r.status, 'amount', d.amount, 'period', pp.period_name) order by d.created_at)
                    from public.employee_cash_advance_deductions d join public.payroll_runs r on r.id = d.payroll_run_id
                    left join public.payroll_periods pp on pp.id = r.period_id where d.advance_id = a.id), '[]'::jsonb));
$$;
revoke all on function public.cash_advance_json(public.employee_cash_advances) from public;

-- An advance still open: waiting, approved, or released with a balance left.
create or replace function public.cash_advance_open(p_employee uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.employee_cash_advances a
   where a.employee_id = p_employee and (a.status in ('requested', 'approved')
         or (a.status = 'released' and a.amount - public.cash_advance_deducted(a.id) > 0))
   order by a.requested_at desc limit 1;
$$;
revoke all on function public.cash_advance_open(uuid) from public;

create or replace function public.cash_advance_notify_targets(p_business uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.users where business_id = p_business and role = 'business_admin' and is_active;
$$;
revoke all on function public.cash_advance_notify_targets(uuid) from public;

-- ----------------------------------------------------------- the employee --
create or replace function public.my_cash_advance()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e record; v_monthly numeric; a public.employee_cash_advances;
begin
  select * into e from public.employees where user_id = auth.uid() limit 1;
  if not found then return null; end if;
  v_monthly := public.cash_advance_monthly_pay(e.id);
  return jsonb_build_object(
    'limit', case when v_monthly is null then null else round(v_monthly / 2, 2) end,
    'open_id', public.cash_advance_open(e.id),
    'history', coalesce((select jsonb_agg(public.cash_advance_json(x) order by x.requested_at desc)
                          from (select * from public.employee_cash_advances where employee_id = e.id order by requested_at desc limit 10) x), '[]'::jsonb));
end $$;
revoke all on function public.my_cash_advance() from public;
grant execute on function public.my_cash_advance() to authenticated;

create or replace function public.cash_advance_request(p_amount numeric, p_payments int, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; v_monthly numeric; v_amt numeric := round(coalesce(p_amount, 0), 2); v_id uuid; v_n int;
begin
  select * into e from public.employees where user_id = auth.uid() limit 1;
  if not found then raise exception 'Your account is not linked to an employee record. Ask your Business Admin to link it.'; end if;
  if e.employment_status in ('separated', 'inactive', 'suspended') then raise exception 'Cash advances are for current employees.'; end if;
  if v_amt <= 0 then raise exception 'Enter the amount.'; end if;
  if p_payments is null or p_payments < 1 or p_payments > 12 then raise exception 'Repay in 1 to 12 payments (up to 6 months).'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say what the advance is for.'; end if;
  if public.cash_advance_open(e.id) is not null then raise exception 'You already have an open cash advance; it must be paid off before a new one.'; end if;
  v_monthly := public.cash_advance_monthly_pay(e.id);
  if v_monthly is null or v_monthly <= 0 then raise exception 'Your pay is not set up in payroll yet; ask HR.'; end if;
  if v_amt > round(v_monthly / 2, 2) then raise exception 'The most you can request is half a month''s pay: ₱%.', to_char(round(v_monthly / 2, 2), 'FM999,999,990.00'); end if;
  select count(*) + 1 into v_n from public.employee_cash_advances where business_id = e.business_id;
  insert into public.employee_cash_advances(business_id, advance_number, employee_id, amount, payments, instalment, reason, monthly_pay, requested_by)
  values (e.business_id, 'CA-' || lpad(v_n::text, 4, '0'), e.id, v_amt, p_payments, round(v_amt / p_payments, 2), btrim(p_reason), v_monthly, auth.uid())
  returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'employee_cash_advances', v_id, 'submitted', jsonb_build_object('amount', v_amt, 'payments', p_payments));
  return v_id;
end $$;
revoke all on function public.cash_advance_request(numeric, int, text) from public;
grant execute on function public.cash_advance_request(numeric, int, text) to authenticated;

create or replace function public.cash_advance_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.employee_cash_advances a set status = 'cancelled', decided_at = now()
   where a.id = p_id and a.status = 'requested' and exists (select 1 from public.employees e where e.id = a.employee_id and e.user_id = auth.uid());
  if not found then raise exception 'Only your own request still waiting for approval can be cancelled.'; end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'employee_cash_advances', p_id, 'cancelled', '{}'::jsonb);
end $$;
revoke all on function public.cash_advance_cancel(uuid) from public;
grant execute on function public.cash_advance_cancel(uuid) to authenticated;

-- ------------------------------------------------- Business Admin / Finance --
create or replace function public.cash_advances_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id();
begin
  if not (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')) then raise exception 'Access denied.'; end if;
  return coalesce((select jsonb_agg(public.cash_advance_json(a) order by a.requested_at desc)
                     from public.employee_cash_advances a where a.business_id = v_b), '[]'::jsonb);
end $$;
revoke all on function public.cash_advances_list() from public;
grant execute on function public.cash_advances_list() to authenticated;

create or replace function public.cash_advance_decide(p_id uuid, p_approve boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'The Business Admin approves cash advances.'; end if;
  select * into a from public.employee_cash_advances where id = p_id for update;
  if not found or not (public.is_super_admin() or a.business_id = public.current_business_id()) then raise exception 'Cash advance not found.'; end if;
  if a.status <> 'requested' then raise exception 'This request is no longer waiting for a decision.'; end if;
  if a.requested_by = auth.uid() then raise exception 'You cannot approve your own cash advance.'; end if;
  if not p_approve and coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the request is rejected.'; end if;
  update public.employee_cash_advances set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), rejection_reason = case when p_approve then null else btrim(p_reason) end
   where id = p_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'employee_cash_advances', p_id, case when p_approve then 'approved' else 'rejected' end, jsonb_build_object('reason', p_reason));
end $$;
revoke all on function public.cash_advance_decide(uuid, boolean, text) from public;
grant execute on function public.cash_advance_decide(uuid, boolean, text) to authenticated;

create or replace function public.cash_advance_release(p_id uuid, p_bank_account uuid, p_method text default 'cash')
returns void language plpgsql security definer set search_path = public as $$
declare a record; v_date date := (now() at time zone 'Asia/Manila')::date; v_je uuid; v_who text;
begin
  if not (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')) then raise exception 'Finance releases cash advances.'; end if;
  select * into a from public.employee_cash_advances where id = p_id for update;
  if not found or not (public.is_super_admin() or a.business_id = public.current_business_id()) then raise exception 'Cash advance not found.'; end if;
  if a.status <> 'approved' then raise exception 'Only an approved cash advance can be released.'; end if;
  if p_bank_account is not null and not exists (select 1 from public.finance_bank_accounts where id = p_bank_account and business_id = a.business_id) then
    raise exception 'Choose one of this store''s cash / bank accounts.';
  end if;
  perform public.fin_ensure_accounts_ca(a.business_id);
  select coalesce(e.preferred_name, e.first_name || ' ' || e.last_name) into v_who from public.employees e where e.id = a.employee_id;
  v_je := public.fin_auto_journal(a.business_id, v_date, 'Cash advance ' || a.advance_number || ' — ' || v_who, 'cash_advance', a.id, jsonb_build_array(
    jsonb_build_object('code', '1330', 'debit', a.amount, 'text', 'Cash advance ' || a.advance_number || ' — ' || v_who),
    jsonb_build_object('code', public.fin_cash_code(a.business_id, p_bank_account, coalesce(p_method, 'cash')), 'credit', a.amount, 'text', 'Cash advance ' || a.advance_number || ' released')));
  update public.employee_cash_advances set status = 'released', released_by = auth.uid(), released_at = now(),
         release_bank_account_id = p_bank_account, release_journal_id = v_je where id = p_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'employee_cash_advances', p_id, 'released', jsonb_build_object('amount', a.amount, 'journal_entry_id', v_je));
end $$;
revoke all on function public.cash_advance_release(uuid, uuid, text) from public;
grant execute on function public.cash_advance_release(uuid, uuid, text) to authenticated;

-- ------------------------------------------------------------------ payroll --
-- Deduct each released advance from a draft payroll run: the instalment (or what is left), the whole
-- balance for an employee who has separated, never more than the entry's pay after its other
-- deductions. Safe to run again on the same draft run.
create or replace function public.payroll_apply_cash_advances(p_run uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; en record; a record; v_left numeric; v_take numeric; v_room numeric; n int := 0; v_sep boolean;
begin
  select * into r from public.payroll_runs where id = p_run;
  if not found then raise exception 'Payroll run not found.'; end if;
  if not (public.is_super_admin() or (r.business_id = public.current_business_id() and (public.is_business_admin() or public.has_section_access('finance')))) then
    raise exception 'Finance access is required.';
  end if;
  if r.status::text <> 'draft' then raise exception 'Cash advances are applied only to a draft payroll run.'; end if;
  -- undo a previous application on this run
  update public.payroll_entries e set total_deductions = total_deductions - cash_advance, net_pay = net_pay + cash_advance, cash_advance = 0
   where e.payroll_run_id = p_run and cash_advance <> 0;
  delete from public.employee_cash_advance_deductions where payroll_run_id = p_run;
  for en in select * from public.payroll_entries where payroll_run_id = p_run loop
    select * into a from public.employee_cash_advances
     where employee_id = en.employee_id and status = 'released' and amount - public.cash_advance_deducted(id) > 0
     order by released_at limit 1;
    continue when not found;
    v_left := a.amount - public.cash_advance_deducted(a.id);
    select employment_status = 'separated' into v_sep from public.employees where id = en.employee_id;
    v_take := case when v_sep then v_left else least(a.instalment, v_left) end;
    -- the last regular payment takes the few centavos left by rounding
    if not v_sep and v_left - v_take < 1 then v_take := v_left; end if;
    v_room := greatest(coalesce(en.gross_pay, 0) - coalesce(en.total_deductions, 0), 0);
    v_take := round(least(v_take, v_room), 2);
    continue when v_take <= 0;
    update public.payroll_entries set cash_advance = v_take, total_deductions = coalesce(total_deductions, 0) + v_take,
           net_pay = coalesce(gross_pay, 0) - (coalesce(total_deductions, 0) + v_take), updated_at = now() where id = en.id;
    insert into public.employee_cash_advance_deductions(advance_id, payroll_run_id, payroll_entry_id, amount) values (a.id, p_run, en.id, v_take);
    n := n + 1;
  end loop;
  perform public.recalculate_payroll_run_totals(p_run);
  return n;
end $$;
revoke all on function public.payroll_apply_cash_advances(uuid) from public;
grant execute on function public.payroll_apply_cash_advances(uuid) to authenticated;

-- Contributions recomputed: keep the cash advance in the deductions.
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
             + round((sh->>'hdmf_ee')::numeric * v_factor, 2) + coalesce(e.other_deductions, 0) + coalesce(e.cash_advance, 0);
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

-- Payroll journal: cash advances recovered credit 1330 instead of being paid out.
create or replace function public.fin_payroll_lines(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t record; v_b uuid := (select business_id from public.payroll_runs where id = p_run);
begin
  perform public.fin_ensure_accounts_er(v_b);
  perform public.fin_ensure_accounts_ca(v_b);
  select round(coalesce(sum(gross_pay), 0), 2) g, round(coalesce(sum(social_security), 0), 2) sss, round(coalesce(sum(health_contribution), 0), 2) ph,
         round(coalesce(sum(housing_fund), 0), 2) hd, round(coalesce(sum(tax_withheld), 0), 2) tax, round(coalesce(sum(other_deductions), 0), 2) oth,
         round(coalesce(sum(cash_advance), 0), 2) ca,
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
    jsonb_build_object('code', '1330', 'credit', t.ca, 'text', 'Cash advances recovered'),
    jsonb_build_object('code', '2105', 'credit', t.g - t.sss - t.ph - t.hd - t.tax - t.oth - t.ca, 'text', 'Net pay due'));
end $$;
revoke all on function public.fin_payroll_lines(uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.fin_payroll_lines(uuid) from authenticated; revoke all on function public.fin_ensure_accounts_ca(uuid) from authenticated;
  end if;
end $$;

-- Who to tell about a new request: the store's Business Admins (the requester may read only their own row).
create or replace function public.cash_advance_notify_targets_for(p_advance uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select public.cash_advance_notify_targets(a.business_id) from public.employee_cash_advances a
   where a.id = p_advance and (a.requested_by = auth.uid() or public.is_super_admin());
$$;
revoke all on function public.cash_advance_notify_targets_for(uuid) from public;
grant execute on function public.cash_advance_notify_targets_for(uuid) to authenticated;
