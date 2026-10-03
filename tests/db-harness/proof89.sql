-- Build 89 (BUD-01 budgets from actuals, scenarios, accruals) proof: run after proof78-88. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
-- 2025 actuals for PILI: sales / cost of sales journals, expenses (one yearly, spread over 12 months)
insert into months(business_id, year, month, label) values (proof.get('pili')::uuid, 2025, 3, 'March 2025') on conflict do nothing;
insert into admin_expense_categories(code, name, gl_account_code, active) values ('p89_rent', 'P89 Rent', '5200', true), ('p89_permit', 'P89 Business Permit', '5200', true) on conflict (code) do nothing;
do $$ declare b uuid := proof.get('pili')::uuid; je uuid; m int; sec uuid := (select id from sections where code = 'admin'); mo uuid; begin
  mo := (select id from months where business_id = b and year = 2025 and month = 3);
  for m in 1..12 loop
    insert into finance_journal_entries(business_id, journal_number, entry_date, description, status, total_debit, total_credit)
    values (b, 'P89-' || m, make_date(2025, m, 28), 'proof89 sales', 'posted', 1000 * m + 600 * m, 1000 * m + 600 * m) returning id into je;
    insert into finance_journal_lines(business_id, journal_entry_id, account_id, debit, credit) values
      (b, je, sf_gl(b, '1090'), 1000 * m, 0), (b, je, sf_gl(b, '4000'), 0, 1000 * m), (b, je, sf_gl(b, '5000'), 600 * m, 0), (b, je, sf_gl(b, '1090'), 0, 600 * m);
    insert into expenses(business_id, section_id, month_id, description, amount, status, expense_date, category_id)
    values (b, sec, mo, 'proof89 rent', 9000, 'paid', make_date(2025, m, 5), (select id from admin_expense_categories where code = 'p89_rent'));
  end loop;
  insert into expenses(business_id, section_id, month_id, description, amount, status, expense_date, category_id, is_yearly, spread_months)
  values (b, sec, mo, 'proof89 permit', 12000, 'paid', '2025-01-10', (select id from admin_expense_categories where code = 'p89_permit'), true, 12);
end $$;

\echo == A. new budget from actuals
select proof.as_user('00000000-0000-0000-0000-000000000013');   -- cashier
select proof.fails($$select public.budget_create_from_actuals(2026, 2025)$$, 'Finance prepares', 'a cashier cannot make budgets');
select proof.as_user('00000000-0000-0000-0000-000000000015');   -- PILI finance
select proof.fails($$select public.budget_create_from_actuals(2025, 2025)$$, 'after the base year', 'the budget year must be after the base year');
select proof.set('bud', public.budget_create_from_actuals(2026, 2025, 'Proof89 budget', 'same_month')::text);
select proof.ok((select jan_budget = 1000 and dec_budget = 12000 from finance_budget_lines where budget_id = proof.get('bud')::uuid and line_key = 'SALES'), 'Sales line: each month = the same month last year (Jan 1,000 … Dec 12,000)');
select proof.ok((select mar_budget = 1800 from finance_budget_lines where budget_id = proof.get('bud')::uuid and line_key = 'COGS'), 'Cost of sales line from the 5000 account');
select proof.ok((select jan_budget = 9000 and account_name = 'P89 Rent' and timing = 'monthly' from finance_budget_lines where budget_id = proof.get('bud')::uuid and line_key like 'EXP:%' and account_name = 'P89 Rent'), 'one line per expense category, filled with this year''s actual');
select proof.ok((select timing = 'yearly' and annual_amount = 12000 and jun_budget = 1000 and pay_month = 1 from finance_budget_lines where budget_id = proof.get('bud')::uuid and account_name = 'P89 Business Permit'), 'a permit becomes a yearly line accrued 1/12 a month');
select proof.ok(exists (select 1 from finance_budget_scenarios where budget_id = proof.get('bud')::uuid and is_base), 'a Base scenario is created');
select proof.set('avg', public.budget_create_from_actuals(2026, 2025, 'Proof89 average', 'average')::text);
select proof.ok((select jan_budget = 6500 and dec_budget = 6500 from finance_budget_lines where budget_id = proof.get('avg')::uuid and line_key = 'SALES'), 'the "average" baseline spreads the year evenly (78,000 / 12)');

\echo == B. scenarios, approval lock
insert into finance_budget_scenarios(business_id, budget_id, name) values (proof.get('pili')::uuid, proof.get('bud')::uuid, 'Growth') returning id \gset s_
insert into finance_budget_actions(business_id, scenario_id, title, target, change_kind, value) values (proof.get('pili')::uuid, :'s_id', 'Grow sales', 'all_revenue', 'percent', 10);
select proof.ok((select count(*) from finance_budget_actions where scenario_id = :'s_id') = 1, 'Finance adds actions to a scenario');
reset role; select proof.as_owner();
update finance_budgets set status = 'approved', approved_scenario_id = :'s_id' where id = proof.get('bud')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000015');
select proof.fails($$update finance_budget_lines set jan_budget = 1 where budget_id = proof.get('bud')::uuid$$, 'approved', 'an approved budget''s lines are locked');
select proof.fails($$update finance_budget_actions set value = 99 where scenario_id = (select id from finance_budget_scenarios where name = 'Growth' and budget_id = proof.get('bud')::uuid)$$, 'approved', 'an approved scenario''s numbers are locked');
update finance_budget_actions set status = 'done' where scenario_id = :'s_id';
select proof.ok((select status from finance_budget_actions where scenario_id = :'s_id') = 'done', 'after approval an action''s status can still be tracked');

\echo == C. actuals stay in their store
select proof.as_user('00000000-0000-0000-0000-000000000021');   -- ATON cashier
select proof.ok((select count(*) from public.budget_actuals(proof.get('pili')::uuid, 2025)) = 0, 'another store sees no actuals for PILI');
\echo == Build 89 proof passed
rollback;
