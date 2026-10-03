-- ============================================================================
-- Build 80 — EXP-01 expenses rework (owner decisions 2026-10-03)
--
-- 1. Posting an expense now books it in the ledger. Until now "Post" only
--    changed the status, so expenses never reached the dashboards (they read
--    posted journal lines). Posting and paying are Finance's: a Finance
--    approver or a Business Admin, through expense_post / expense_pay
--    (department approvers no longer post or pay their own expenses).
--      post:  Dr the category's expense account (or Prepaid) / Cr Accounts Payable
--      pay:   Dr Accounts Payable / Cr the bank / cash account paid from
-- 2. Categories are Finance's: each category names its expense account
--    (gl_account_code, default 5200 Operating Expenses). Departments pick a
--    category or suggest one ("Other: suggest a category"); Finance maps the
--    suggestion (expense_set_category) or creates the category
--    (expense_category_save). The expense is not held up meanwhile.
-- 3. Annualization (accrual practice, in the books):
--    * prepaid — an expense posted "spread over N months" goes to 1300
--      Prepaid Expenses; each month-end run moves 1/N to its expense account;
--    * accrual — a year-end cost (bonus, audit fee …) set up with an estimate
--      and months; each month-end run sets aside 1/N in 2120 Accrued
--      Expenses; the actual bill, posted against the accrual, clears it and
--      books the difference (true-up);
--    * 13th month — each month-end run sets aside 1/12 of that month's basic
--      pay from approved / posted payroll in 2110 Accrued 13th Month Pay
--      (catching up if payroll changed); the December payout expense posted
--      against it clears it with a true-up.
-- 4. Finance's "All expenses" register: every department, any period.
-- ============================================================================

-- ---------------------------------------------------------------- accounts --
insert into public.finance_chart_of_accounts(business_id, account_code, account_name, account_type, description)
select b.id, a.code, a.name, a.type::public.finance_account_type, a.descr
  from public.businesses b
 cross join (values
   ('1300','Prepaid Expenses','asset','Paid in advance, spread to expense month by month'),
   ('2110','Accrued 13th Month Pay','liability','1/12 of basic pay set aside each month'),
   ('2120','Accrued Expenses','liability','Year-end costs set aside month by month'),
   ('5110','13th Month Pay','expense',null)
 ) a(code, name, type, descr)
 where not exists (select 1 from public.finance_chart_of_accounts c where c.business_id = b.id and c.account_code = a.code);

-- ------------------------------------------------------------------ tables --
alter table public.admin_expense_categories add column if not exists gl_account_code text not null default '5200';

alter table public.expenses add column if not exists suggested_category text;
alter table public.expenses add column if not exists is_yearly boolean not null default false;
alter table public.expenses add column if not exists spread_months int;
alter table public.expenses add column if not exists journal_entry_id uuid references public.finance_journal_entries(id);
alter table public.expenses add column if not exists payment_journal_id uuid references public.finance_journal_entries(id);
alter table public.expenses add column if not exists accrual_schedule_id uuid;
alter table public.expenses drop constraint if exists expenses_spread_months_check;
alter table public.expenses add constraint expenses_spread_months_check check (spread_months is null or spread_months between 1 and 60);

create table if not exists public.finance_expense_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  kind text not null check (kind in ('prepaid','accrual','thirteenth')),
  description text not null,
  category_id uuid references public.admin_expense_categories(id),
  expense_account_code text not null,
  balance_account_code text not null,
  total_amount numeric(14,2),               -- null for 13th month (follows payroll)
  months int not null check (months between 1 and 60),
  start_month date not null check (extract(day from start_month) = 1),
  source_expense_id uuid references public.expenses(id),
  settled_expense_id uuid references public.expenses(id),
  status text not null default 'active' check (status in ('active','settled','cancelled')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create unique index if not exists finance_expense_schedules_13th on public.finance_expense_schedules(business_id, start_month) where kind = 'thirteenth';
alter table public.expenses drop constraint if exists expenses_accrual_schedule_fk;
alter table public.expenses add constraint expenses_accrual_schedule_fk foreign key (accrual_schedule_id) references public.finance_expense_schedules(id);

create table if not exists public.finance_expense_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  schedule_id uuid not null references public.finance_expense_schedules(id) on delete cascade,
  period date not null,
  amount numeric(14,2) not null,
  journal_entry_id uuid references public.finance_journal_entries(id),
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);
create index if not exists finance_expense_schedule_entries_sched on public.finance_expense_schedule_entries(schedule_id, period);

alter table public.finance_expense_schedules enable row level security;
alter table public.finance_expense_schedule_entries enable row level security;
drop policy if exists finance_expense_schedules_read on public.finance_expense_schedules;
create policy finance_expense_schedules_read on public.finance_expense_schedules for select
  using (public.business_row_visible(business_id) and (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')));
drop policy if exists finance_expense_schedule_entries_read on public.finance_expense_schedule_entries;
create policy finance_expense_schedule_entries_read on public.finance_expense_schedule_entries for select
  using (public.business_row_visible(business_id) and (public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')));
grant select on public.finance_expense_schedules, public.finance_expense_schedule_entries to authenticated;

-- Posting and paying go through expense_post / expense_pay only. The old
-- policy also carried the only WITH CHECK that let the approver's update to
-- 'approved' (and a reviewer's return to draft) pass, so the reviewer and
-- approver policies now state what they may move a row to.
drop policy if exists expenses_update_finance_post on public.expenses;
drop policy if exists expenses_update_reviewer on public.expenses;
create policy expenses_update_reviewer on public.expenses for update
  using (public.has_workflow_role(section_id, 'reviewer') and status = 'prepared')
  with check (public.has_workflow_role(section_id, 'reviewer') and status::text in ('prepared','reviewed','draft'));
drop policy if exists expenses_update_approver on public.expenses;
create policy expenses_update_approver on public.expenses for update
  using (public.has_workflow_role(section_id, 'approver') and status = 'reviewed')
  with check (public.has_workflow_role(section_id, 'approver') and status::text in ('reviewed','approved','draft'));

-- Finance posts every department's expenses, so it reads them all (its own
-- store only: the restrictive business policy still applies). The Finance
-- dashboard and cost-center pages read expenses directly.
drop policy if exists expenses_select_finance on public.expenses;
create policy expenses_select_finance on public.expenses for select using (public.has_section_access('finance'));

-- ----------------------------------------------------------------- helpers --
create or replace function public.exp_can_finance()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin()
      or public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver')
$$;
create or replace function public.exp_can_view()
returns boolean language sql stable security definer set search_path = public as $$
  select public.exp_can_finance() or public.has_section_access('finance')
      or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
$$;
grant execute on function public.exp_can_finance(), public.exp_can_view() to authenticated;

create or replace function public.exp_business()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.pricing_business_id();
begin
  if b is null then raise exception 'Select a business in "Acting as" first.'; end if;
  return b;
end $$;
revoke all on function public.exp_business() from public, authenticated;

-- One posted journal: p_lines = [{"code":"5200","debit":100,"credit":0,"text":"…"}, …]
create or replace function public.exp_journal(p_business uuid, p_date date, p_desc text, p_source text, p_source_id uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_code text; v_jno text; v_je uuid; d numeric := 0; c numeric := 0; x jsonb;
begin
  select coalesce(sum(round(coalesce((l->>'debit')::numeric, 0), 2)), 0), coalesce(sum(round(coalesce((l->>'credit')::numeric, 0), 2)), 0)
    into d, c from jsonb_array_elements(p_lines) l;
  if d <= 0 or d <> c then raise exception 'Expense journal does not balance (debit % / credit %).', d, c; end if;
  select code into v_code from public.businesses where id = p_business;
  v_jno := public.storefront_next_number(coalesce(v_code, 'BIZ') || '-EXJ', 'finance_journal_entries', 'journal_number');
  insert into public.finance_journal_entries(business_id, journal_number, entry_date, description, source_module, source_record_id, section_id, status,
                                             total_debit, total_credit, prepared_by, prepared_at, approved_by, approved_at, created_by)
  values (p_business, v_jno, p_date, left(p_desc, 300), p_source, p_source_id, (select id from public.sections where code = 'finance'), 'approved',
          d, c, auth.uid(), now(), auth.uid(), now(), auth.uid())
  returning id into v_je;
  for x in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((x->>'debit')::numeric, 0), 2) > 0 or round(coalesce((x->>'credit')::numeric, 0), 2) > 0 then
      insert into public.finance_journal_lines(business_id, journal_entry_id, account_id, line_description, debit, credit, department)
      values (p_business, v_je, public.sf_gl(p_business, x->>'code'), left(coalesce(x->>'text', p_desc), 300),
              round(coalesce((x->>'debit')::numeric, 0), 2), round(coalesce((x->>'credit')::numeric, 0), 2), 'Finance');
    end if;
  end loop;
  perform public.post_finance_journal(v_je, auth.uid());
  return v_je;
end $$;
revoke all on function public.exp_journal(uuid, date, text, text, uuid, jsonb) from public, authenticated;

create or replace function public.exp_gl_code(p_category uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(trim(gl_account_code), '') from public.admin_expense_categories where id = p_category), '5200')
$$;
revoke all on function public.exp_gl_code(uuid) from public, authenticated;

-- 13th month due for a month: 1/12 of basic pay in approved / posted payroll whose period ends in that month
create or replace function public.exp_13th_due(p_business uuid, p_month date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(coalesce(sum(pe.base_pay), 0) / 12, 2)
    from public.payroll_entries pe
    join public.payroll_runs r on r.id = pe.payroll_run_id
    join public.payroll_periods p on p.id = r.period_id
   where r.business_id = p_business and r.status::text in ('approved','posted')
     and date_trunc('month', p.end_date)::date = date_trunc('month', p_month)::date
$$;
revoke all on function public.exp_13th_due(uuid, date) from public, authenticated;

-- -------------------------------------------------------------- categories --
create or replace function public.expense_category_save(p_id uuid, p_code text, p_name text, p_description text, p_gl_code text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_code text; b uuid := public.exp_business(); v_gl text := coalesce(nullif(trim(p_gl_code), ''), '5200');
begin
  if not public.exp_can_view() then raise exception 'Finance access is required to manage expense categories.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Category name is required.'; end if;
  if not exists (select 1 from public.finance_chart_of_accounts where business_id = b and account_code = v_gl and account_type = 'expense' and active) then
    raise exception 'Account % is not an active expense account.', v_gl;
  end if;
  if v_id is null then
    v_code := lower(regexp_replace(coalesce(nullif(trim(p_code), ''), p_name), '[^a-zA-Z0-9]+', '_', 'g'));
    v_code := trim(both '_' from v_code);
    if exists (select 1 from public.admin_expense_categories where code = v_code or lower(name) = lower(trim(p_name))) then
      raise exception 'A category named % already exists.', trim(p_name);
    end if;
    insert into public.admin_expense_categories(code, name, description, gl_account_code, active, created_by)
    values (v_code, trim(p_name), nullif(trim(p_description), ''), v_gl, coalesce(p_active, true), auth.uid()) returning id into v_id;
  else
    if exists (select 1 from public.admin_expense_categories where id <> v_id and lower(name) = lower(trim(p_name))) then
      raise exception 'A category named % already exists.', trim(p_name);
    end if;
    update public.admin_expense_categories set name = trim(p_name), description = nullif(trim(p_description), ''), gl_account_code = v_gl,
           active = coalesce(p_active, active) where id = v_id;
    if not found then raise exception 'Category not found.'; end if;
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'admin_expense_categories', v_id, case when p_id is null then 'expense_category_created' else 'expense_category_updated' end,
          jsonb_build_object('name', trim(p_name), 'gl_account_code', v_gl, 'active', p_active));
  return v_id;
end $$;
grant execute on function public.expense_category_save(uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.expense_set_category(p_expense uuid, p_category uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.exp_can_view() then raise exception 'Finance access is required to set an expense''s category.'; end if;
  select * into e from public.expenses where id = p_expense for update;
  if not found or not public.business_row_visible(e.business_id) then raise exception 'Expense not found.'; end if;
  if e.status::text in ('posted','paid') then raise exception 'A posted expense keeps its category.'; end if;
  if not exists (select 1 from public.admin_expense_categories where id = p_category and active) then raise exception 'Category not found.'; end if;
  update public.expenses set category_id = p_category, suggested_category = null, updated_at = now() where id = p_expense;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'expenses', p_expense, 'expense_category_mapped', jsonb_build_object('category_id', p_category, 'suggested', e.suggested_category));
end $$;
grant execute on function public.expense_set_category(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- register --
create or replace function public.expense_register(p_from date, p_to date)
returns table(id uuid, expense_date date, section_code text, section_name text, description text, amount numeric, status text,
              category_id uuid, category_name text, gl_account_code text, suggested_category text, supplier_id uuid, supplier_name text,
              vendor text, cost_center text, reference_no text, payment_method text, is_yearly boolean, spread_months int,
              accrual_schedule_id uuid, prepared_by_name text, approved_at timestamptz, posted_at timestamptz, paid_at timestamptz,
              journal_number text, rejection_reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.exp_can_view() then raise exception 'Finance access is required to see all expenses.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid period.'; end if;
  if p_to - p_from > 400 then raise exception 'Choose a period of at most about a year.'; end if;
  return query
  select e.id, coalesce(e.expense_date, e.created_at::date), s.code::text, s.name::text, e.description, e.amount, e.status::text,
         e.category_id, c.name, c.gl_account_code, e.suggested_category, e.supplier_id, sup.legal_name, e.vendor,
         cc.code || ' — ' || cc.name, e.reference_no, e.payment_method, e.is_yearly, e.spread_months, e.accrual_schedule_id,
         pu.full_name, e.approved_at, e.posted_at, e.paid_at, je.journal_number, e.rejection_reason
    from public.expenses e
    join public.sections s on s.id = e.section_id
    left join public.admin_expense_categories c on c.id = e.category_id
    left join public.finance_suppliers sup on sup.id = e.supplier_id
    left join public.finance_cost_centers cc on cc.id = e.cost_center_id
    left join public.users pu on pu.id = e.prepared_by
    left join public.finance_journal_entries je on je.id = e.journal_entry_id
   where e.business_id = public.exp_business()
     and coalesce(e.expense_date, e.created_at::date) between p_from and p_to
   order by coalesce(e.expense_date, e.created_at::date) desc, e.created_at desc;
end $$;
grant execute on function public.expense_register(date, date) to authenticated;

-- -------------------------------------------------------------------- post --
create or replace function public.expense_post(p_expense uuid, p_category uuid, p_spread_months int, p_start date, p_accrual uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; s record; b uuid := public.exp_business(); v_cat uuid; v_gl text; v_date date; v_je uuid; v_amt numeric;
        v_booked numeric; v_diff numeric; v_months int := coalesce(p_spread_months, 1); v_lines jsonb;
begin
  if not public.exp_can_finance() then raise exception 'A Finance approver posts expenses.'; end if;
  select * into e from public.expenses where id = p_expense for update;
  if not found or e.business_id is distinct from b then raise exception 'Expense not found.'; end if;
  if e.status::text <> 'approved' then raise exception 'Only approved expenses can be posted.'; end if;
  if v_months < 1 or v_months > 60 then raise exception 'Spread over 1 to 60 months.'; end if;
  if v_months > 1 and p_accrual is not null then raise exception 'An expense is either spread or charged against an accrual, not both.'; end if;
  v_cat := coalesce(p_category, e.category_id);
  if v_cat is null then raise exception 'Choose a category before posting%.', coalesce(' (suggested: ' || e.suggested_category || ')', ''); end if;
  if not exists (select 1 from public.admin_expense_categories where id = v_cat) then raise exception 'Category not found.'; end if;
  v_gl := public.exp_gl_code(v_cat);
  v_date := coalesce(e.expense_date, (now() at time zone 'Asia/Manila')::date);
  v_amt := round(e.amount, 2);

  if v_months > 1 then
    v_je := public.exp_journal(b, v_date, 'Prepaid expense: ' || e.description, 'expenses', e.id, jsonb_build_array(
      jsonb_build_object('code', '1300', 'debit', v_amt, 'text', 'Prepaid — ' || e.description),
      jsonb_build_object('code', '2000', 'credit', v_amt, 'text', coalesce(e.vendor, e.description))));
    insert into public.finance_expense_schedules(business_id, kind, description, category_id, expense_account_code, balance_account_code,
                                                 total_amount, months, start_month, source_expense_id, created_by)
    values (b, 'prepaid', e.description, v_cat, v_gl, '1300', v_amt, v_months,
            date_trunc('month', coalesce(p_start, v_date))::date, e.id, auth.uid());
  elsif p_accrual is not null then
    select * into s from public.finance_expense_schedules where id = p_accrual for update;
    if not found or s.business_id <> b or s.kind not in ('accrual','thirteenth') or s.status <> 'active' then
      raise exception 'Choose an open accrual of this store.';
    end if;
    select coalesce(sum(amount), 0) into v_booked from public.finance_expense_schedule_entries where schedule_id = s.id;
    v_diff := v_amt - v_booked;   -- > 0: more than set aside (extra expense); < 0: less (reverse the excess)
    v_lines := jsonb_build_array(jsonb_build_object('code', '2000', 'credit', v_amt, 'text', coalesce(e.vendor, e.description)));
    if v_booked > 0 then v_lines := v_lines || jsonb_build_object('code', s.balance_account_code, 'debit', v_booked, 'text', 'Clears ' || s.description); end if;
    if v_diff > 0 then v_lines := v_lines || jsonb_build_object('code', s.expense_account_code, 'debit', v_diff, 'text', 'True-up — ' || s.description); end if;
    if v_diff < 0 then v_lines := v_lines || jsonb_build_object('code', s.expense_account_code, 'credit', -v_diff, 'text', 'True-up — ' || s.description); end if;
    v_je := public.exp_journal(b, v_date, 'Expense against accrual: ' || e.description, 'expenses', e.id, v_lines);
    update public.finance_expense_schedules set status = 'settled', settled_expense_id = e.id where id = s.id;
  else
    v_je := public.exp_journal(b, v_date, 'Expense: ' || e.description, 'expenses', e.id, jsonb_build_array(
      jsonb_build_object('code', v_gl, 'debit', v_amt, 'text', e.description),
      jsonb_build_object('code', '2000', 'credit', v_amt, 'text', coalesce(e.vendor, e.description))));
  end if;

  update public.expenses
     set status = 'posted', posted_by = auth.uid(), posted_at = now(), category_id = v_cat,
         suggested_category = case when p_category is not null then null else suggested_category end,
         spread_months = case when v_months > 1 then v_months else spread_months end,
         accrual_schedule_id = p_accrual, journal_entry_id = v_je, updated_at = now()
   where id = e.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'expenses', e.id, 'expense_posted', jsonb_build_object('journal_entry_id', v_je, 'spread_months', v_months, 'accrual', p_accrual));
  return v_je;
end $$;
grant execute on function public.expense_post(uuid, uuid, int, date, uuid) to authenticated;

-- --------------------------------------------------------------------- pay --
create or replace function public.expense_pay(p_expense uuid, p_bank_account uuid, p_date date)
returns uuid language plpgsql security definer set search_path = public as $$
declare e record; a record; b uuid := public.exp_business(); v_code text; v_tno text; v_tx uuid; v_je uuid; v_date date := coalesce(p_date, (now() at time zone 'Asia/Manila')::date);
begin
  if not public.exp_can_finance() then raise exception 'A Finance approver records expense payments.'; end if;
  select * into e from public.expenses where id = p_expense for update;
  if not found or e.business_id is distinct from b then raise exception 'Expense not found.'; end if;
  if e.status::text <> 'posted' then raise exception 'Only posted expenses can be marked paid.'; end if;
  select * into a from public.finance_bank_accounts where id = p_bank_account and business_id = b and status = 'active';
  if not found then raise exception 'Choose an active bank / cash account of this store.'; end if;
  select code into v_code from public.businesses where id = b;
  v_tno := public.storefront_next_number(coalesce(v_code, 'BIZ') || '-EXP', 'finance_cash_transactions', 'transaction_number');
  insert into public.finance_cash_transactions(business_id, transaction_number, bank_account_id, transaction_date, transaction_type, amount, direction,
                                               description, counterparty, reference_number, source_module, source_record_id, status, prepared_by, prepared_at,
                                               posted_by, posted_at, created_by)
  values (b, v_tno, a.id, v_date, 'withdrawal', e.amount, 'out', 'Expense payment: ' || e.description, e.vendor, e.reference_no,
          'expenses', e.id, 'posted', auth.uid(), now(), auth.uid(), now(), auth.uid())
  returning id into v_tx;
  v_je := public.exp_journal(b, v_date, 'Expense payment: ' || e.description, 'expense_payment', e.id, jsonb_build_array(
    jsonb_build_object('code', '2000', 'debit', e.amount, 'text', coalesce(e.vendor, e.description)),
    jsonb_build_object('code', coalesce((select account_code from public.finance_chart_of_accounts where id = a.gl_account_id),
                                        case when a.is_cash_on_hand then '1000' else '1010' end), 'credit', e.amount, 'text', a.account_name)));
  update public.expenses set status = 'paid', paid_by = auth.uid(), paid_at = now(), payment_journal_id = v_je, updated_at = now() where id = e.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'expenses', e.id, 'expense_paid', jsonb_build_object('cash_transaction_id', v_tx, 'journal_entry_id', v_je, 'bank_account_id', a.id));
  return v_tx;
end $$;
grant execute on function public.expense_pay(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------- accruals --
create or replace function public.expense_accrual_create(p_description text, p_category uuid, p_total numeric, p_months int, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.exp_business(); v_id uuid;
begin
  if not public.exp_can_finance() then raise exception 'A Finance approver sets up accruals.'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Description is required.'; end if;
  if coalesce(p_total, 0) <= 0 then raise exception 'Estimated amount must be greater than zero.'; end if;
  if coalesce(p_months, 0) not between 1 and 60 then raise exception 'Spread over 1 to 60 months.'; end if;
  if p_category is null or not exists (select 1 from public.admin_expense_categories where id = p_category) then raise exception 'Choose a category.'; end if;
  insert into public.finance_expense_schedules(business_id, kind, description, category_id, expense_account_code, balance_account_code,
                                               total_amount, months, start_month, created_by)
  values (b, 'accrual', trim(p_description), p_category, public.exp_gl_code(p_category), '2120', round(p_total, 2), p_months,
          date_trunc('month', coalesce(p_start, (now() at time zone 'Asia/Manila')::date))::date, auth.uid())
  returning id into v_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_expense_schedules', v_id, 'expense_accrual_created', jsonb_build_object('total', p_total, 'months', p_months));
  return v_id;
end $$;
grant execute on function public.expense_accrual_create(text, uuid, numeric, int, date) to authenticated;

create or replace function public.expense_schedule_cancel(p_schedule uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not public.exp_can_finance() then raise exception 'A Finance approver cancels schedules.'; end if;
  select * into s from public.finance_expense_schedules where id = p_schedule for update;
  if not found or s.business_id <> public.exp_business() then raise exception 'Schedule not found.'; end if;
  if s.status <> 'active' then raise exception 'Only an active schedule can be cancelled.'; end if;
  if s.kind = 'prepaid' then raise exception 'A prepaid expense is spread to the end; it cannot be cancelled.'; end if;
  if exists (select 1 from public.finance_expense_schedule_entries where schedule_id = s.id) then
    raise exception 'Months were already set aside; post the actual expense against this accrual instead.';
  end if;
  update public.finance_expense_schedules set status = 'cancelled' where id = s.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_expense_schedules', s.id, 'expense_schedule_cancelled', '{}'::jsonb);
end $$;
grant execute on function public.expense_schedule_cancel(uuid) to authenticated;

-- ---------------------------------------------------------- month-end run --
-- Books every month up to p_month that is due and not booked yet (catch-up),
-- and the 13th-month set-aside of the year so far (difference only).
create or replace function public.expense_month_run(p_month date)
returns table(schedule text, period date, amount numeric, journal_number text)
language plpgsql security definer set search_path = public as $$
declare b uuid := public.exp_business(); v_m date := date_trunc('month', p_month)::date; s record; per date; i int;
        v_amt numeric; v_prev numeric; v_je uuid; v_13 uuid; v_due numeric; v_booked numeric; v_jno text; v_entry uuid;
begin
  if not public.exp_can_finance() then raise exception 'A Finance approver runs the month-end spread.'; end if;
  if p_month is null or v_m > date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date then
    raise exception 'Run the month-end for the current or a past month.';
  end if;

  -- 13th month: one schedule per business per year
  insert into public.finance_expense_schedules(business_id, kind, description, expense_account_code, balance_account_code, months, start_month, created_by)
  values (b, 'thirteenth', '13th month pay ' || extract(year from v_m), '5110', '2110', 12, date_trunc('year', v_m)::date, auth.uid())
  on conflict (business_id, start_month) where kind = 'thirteenth' do nothing;

  for s in select * from public.finance_expense_schedules
            where business_id = b and status = 'active' and start_month <= v_m order by start_month, created_at loop
    if s.kind = 'thirteenth' then
      for i in 0 .. 11 loop
        per := (s.start_month + make_interval(months => i))::date;
        exit when per > v_m;
        v_due := public.exp_13th_due(b, per);
        select coalesce(sum(x.amount), 0) into v_booked from public.finance_expense_schedule_entries x where x.schedule_id = s.id and x.period = per;
        v_amt := round(v_due - v_booked, 2);
        continue when v_amt = 0;
        v_je := public.exp_journal(b, (per + interval '1 month' - interval '1 day')::date, s.description || ' — ' || to_char(per, 'FMMonth YYYY'),
                                   'expense_schedule', gen_random_uuid(), case when v_amt > 0 then jsonb_build_array(
                                     jsonb_build_object('code', s.expense_account_code, 'debit', v_amt),
                                     jsonb_build_object('code', s.balance_account_code, 'credit', v_amt)) else jsonb_build_array(
                                     jsonb_build_object('code', s.balance_account_code, 'debit', -v_amt),
                                     jsonb_build_object('code', s.expense_account_code, 'credit', -v_amt)) end);
        insert into public.finance_expense_schedule_entries(business_id, schedule_id, period, amount, journal_entry_id, created_by)
        values (b, s.id, per, v_amt, v_je, auth.uid());
        select j.journal_number into v_jno from public.finance_journal_entries j where j.id = v_je;
        schedule := s.description; period := per; amount := v_amt; journal_number := v_jno; return next;
      end loop;
    else
      for i in 0 .. s.months - 1 loop
        per := (s.start_month + make_interval(months => i))::date;
        exit when per > v_m;
        continue when exists (select 1 from public.finance_expense_schedule_entries x where x.schedule_id = s.id and x.period = per);
        if i = s.months - 1 then
          select coalesce(sum(x.amount), 0) into v_prev from public.finance_expense_schedule_entries x where x.schedule_id = s.id;
          v_amt := round(s.total_amount - v_prev, 2);       -- last month takes the rounding remainder
        else
          v_amt := round(s.total_amount / s.months, 2);
        end if;
        continue when v_amt <= 0;
        v_entry := gen_random_uuid();
        v_je := public.exp_journal(b, (per + interval '1 month' - interval '1 day')::date,
                                   s.description || ' — ' || to_char(per, 'FMMonth YYYY') || ' (' || (i + 1) || ' of ' || s.months || ')',
                                   'expense_schedule', v_entry, jsonb_build_array(
                                     jsonb_build_object('code', s.expense_account_code, 'debit', v_amt),
                                     jsonb_build_object('code', s.balance_account_code, 'credit', v_amt)));
        insert into public.finance_expense_schedule_entries(id, business_id, schedule_id, period, amount, journal_entry_id, created_by)
        values (v_entry, b, s.id, per, v_amt, v_je, auth.uid());
        select j.journal_number into v_jno from public.finance_journal_entries j where j.id = v_je;
        schedule := s.description; period := per; amount := v_amt; journal_number := v_jno; return next;
      end loop;
      if s.kind = 'prepaid' and (select count(*) from public.finance_expense_schedule_entries x where x.schedule_id = s.id) >= s.months then
        update public.finance_expense_schedules set status = 'settled' where id = s.id;
      end if;
    end if;
  end loop;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'businesses', b, 'expense_month_run', jsonb_build_object('month', v_m));
end $$;
grant execute on function public.expense_month_run(date) to authenticated;

-- List with what is set aside / still to spread
create or replace function public.expense_schedules()
returns table(id uuid, kind text, description text, category_name text, expense_account_code text, balance_account_code text,
              total_amount numeric, months int, start_month date, status text, booked numeric, months_booked int,
              remaining numeric, last_period date, source_expense_id uuid, settled_expense_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.exp_can_view() then raise exception 'Finance access is required.'; end if;
  return query
  select s.id, s.kind, s.description, c.name, s.expense_account_code, s.balance_account_code, s.total_amount, s.months, s.start_month, s.status,
         coalesce(x.booked, 0), coalesce(x.n, 0)::int,
         case when s.total_amount is null then null else s.total_amount - coalesce(x.booked, 0) end, x.last_period,
         s.source_expense_id, s.settled_expense_id
    from public.finance_expense_schedules s
    left join public.admin_expense_categories c on c.id = s.category_id
    left join lateral (select sum(e.amount) as booked, count(distinct e.period) as n, max(e.period) as last_period
                         from public.finance_expense_schedule_entries e where e.schedule_id = s.id) x on true
   where s.business_id = public.exp_business()
   order by (s.status = 'active') desc, s.start_month desc, s.created_at desc;
end $$;
grant execute on function public.expense_schedules() to authenticated;

-- Expense accounts for the category screen
create or replace function public.expense_accounts()
returns table(account_code text, account_name text)
language sql stable security definer set search_path = public as $$
  select account_code, account_name from public.finance_chart_of_accounts
   where business_id = public.pricing_business_id() and account_type = 'expense' and active order by account_code
$$;
grant execute on function public.expense_accounts() to authenticated;
