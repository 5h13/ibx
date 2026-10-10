-- Build 98 (Back Office Commission per store: ISHABELLA workbook to the centavo, PILI "% of sales" plans) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
set local ibx.agent_override = 'on';
select proof.set('ish', (select id::text from businesses where code = 'ISHABELLA'));
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('m', '2025-03-01');
-- a clean slate for the two stores' plans, then the set-ups from the sheets
delete from bo_plans where business_id in (proof.get('ish')::uuid, proof.get('pili')::uuid);
insert into sales_agents(agent_code, name, kind, home_business_id) values ('AG-T98R', 'Ptr Rod', 'freelance', proof.get('pili')::uuid);
select public.bo_seed_store_plans();
select proof.ok((select count(*) from bo_plans where business_id = proof.get('ish')::uuid) = 6 and (select count(*) from bo_plans where business_id = proof.get('pili')::uuid) = 4,
                'ISHABELLA gets 6 plans (manager, sales staff, 4 departments), PILI gets 4');
select proof.ok((select count(*) from employees where business_id = proof.get('ish')::uuid and first_name in ('Bert','Riza','Shiena','Glydal','Vincent','Jojo','Mark','Rod')) >= 8,
                'missing ISHABELLA employees are created (first names)');
select proof.ok((select agent_id from bo_plans where business_id = proof.get('pili')::uuid and label like 'Ishabella Sales%') = (select id from sales_agents where agent_code = 'AG-T98R'),
                'PILI''s "Ishabella Sales" is on Ptr Rod''s sales, paid to Bert');

\echo == A. ISHABELLA, August 2026 workbook figures (test month March 2025)
insert into agent_commission_settings(business_id, default_rate, max_rate, start_date, online_rate, savings_rate, deduct_agent_expenses)
values (proof.get('ish')::uuid, 20, 30, '2025-01-01', 20, 5, true)
on conflict (business_id) do update set start_date = '2025-01-01', online_rate = 20, savings_rate = 5, deduct_agent_expenses = true;
insert into bo_category_rates(business_id, category, rate) values (proof.get('ish')::uuid, 'battery', 0.5), (proof.get('ish')::uuid, 'aircon parts', 1), (proof.get('ish')::uuid, 'refrigerants', 1)
on conflict (business_id, category) do update set rate = excluded.rate;
insert into finance_catalog_categories(name, active) values ('Battery', true), ('Aircon Parts', true), ('Refrigerants', true) on conflict do nothing;
insert into finance_procurement_items(id, item_code, item_name, category) values
 ('00000000-0000-0000-0000-0000009800a1', 'T98-BAT', 'Battery T98', 'Battery'), ('00000000-0000-0000-0000-0000009800a2', 'T98-ACP', 'Aircon part T98', 'Aircon Parts'),
 ('00000000-0000-0000-0000-0000009800a3', 'T98-REF', 'Refrigerant T98', 'Refrigerants');
insert into sales_agents(id, agent_code, name, kind, online, home_business_id) values ('00000000-0000-0000-0000-0000009800b1', 'AG-T98O', 'Online T98', 'freelance', true, proof.get('ish')::uuid);
insert into sales_agents(id, agent_code, name, kind, commission_basis, commission_rate, gross_less_expenses, home_business_id)
values ('00000000-0000-0000-0000-0000009800b2', 'AG-T98K', 'Raymart T98', 'freelance', 'gross', 1, true, proof.get('ish')::uuid);
-- three sales, fully paid in the month: walk-in store ₱2,848,080.08 (battery ₱2,629,025 + parts ₱219,055.08), online agent ₱2,249,788.58 (parts),
-- Raymart (Ikot) ₱265,250 (refrigerants). Gross profit: store ₱428,573.37, online ₱763,670.82, Ikot ₱0 → net sales ₱1,192,244.19
insert into finance_customers(id, business_id, customer_code, legal_name, active) values ('00000000-0000-0000-0000-0000009800e1', proof.get('ish')::uuid, 'CUS-T98', 'T98 Client', true);
insert into storefront_sales(id, business_id, sale_number, sale_date, status, agent_id, customer_id, location_id, subtotal, total)
select x.id::uuid, proof.get('ish')::uuid, x.n, '2025-03-10', 'completed', x.ag::uuid, '00000000-0000-0000-0000-0000009800e1', s.location_id, x.t, x.t
  from (values ('00000000-0000-0000-0000-0000009800c1', 'T98-S1', public.sales_agent_store(proof.get('ish')::uuid)::text, 2848080.08),
               ('00000000-0000-0000-0000-0000009800c2', 'T98-S2', '00000000-0000-0000-0000-0000009800b1', 2249788.58),
               ('00000000-0000-0000-0000-0000009800c3', 'T98-S3', '00000000-0000-0000-0000-0000009800b2', 265250::numeric)) x(id, n, ag, t)
  left join storefront_settings s on s.business_id = proof.get('pili')::uuid;   -- ISHABELLA has no storefront in the test data: borrow a location
insert into storefront_sale_items(business_id, sale_id, item_id, item_code, description, unit, item_type, quantity, list_price, unit_price, line_total, acquisition_cost) values
 (proof.get('ish')::uuid, '00000000-0000-0000-0000-0000009800c1', '00000000-0000-0000-0000-0000009800a1', 'T98-BAT', 'Battery', 'pc', 'product', 1, 2629025, 2629025, 2629025, 2234671.25),
 (proof.get('ish')::uuid, '00000000-0000-0000-0000-0000009800c1', '00000000-0000-0000-0000-0000009800a2', 'T98-ACP', 'Parts', 'lot', 'product', 1, 219055.08, 219055.08, 219055.08, 184835.46),
 (proof.get('ish')::uuid, '00000000-0000-0000-0000-0000009800c2', '00000000-0000-0000-0000-0000009800a2', 'T98-ACP', 'Parts', 'lot', 'product', 1, 2249788.58, 2249788.58, 2249788.58, 1486117.76),
 (proof.get('ish')::uuid, '00000000-0000-0000-0000-0000009800c3', '00000000-0000-0000-0000-0000009800a3', 'T98-REF', 'Refrigerant', 'lot', 'product', 1, 265250, 265250, 265250, 265250);
insert into storefront_payments(business_id, payment_number, sale_id, method, amount, kind, received_at) values
 (proof.get('ish')::uuid, 'T98-P1', '00000000-0000-0000-0000-0000009800c1', 'cash', 2848080.08, 'sale', '2025-03-10 10:00+08'),
 (proof.get('ish')::uuid, 'T98-P2', '00000000-0000-0000-0000-0000009800c2', 'cash', 2249788.58, 'sale', '2025-03-10 10:00+08'),
 (proof.get('ish')::uuid, 'T98-P3', '00000000-0000-0000-0000-0000009800c3', 'cash', 265250, 'sale', '2025-03-10 10:00+08');
-- Ikot expenses ₱11,048 (approved agent expenses); store expenses of the month ₱753,463.83
insert into agent_expenses(business_id, expense_number, agent_id, expense_date, category_id, amount, description, status)
values (proof.get('ish')::uuid, 'T98-E1', '00000000-0000-0000-0000-0000009800b2', '2025-03-12', (select id from admin_expense_categories where code = 'transportation'), 11048, 'Ikot trips', 'approved');
insert into months(business_id, year, month, label) values (proof.get('ish')::uuid, 2025, 3, 'March 2025') on conflict do nothing;
insert into expenses(section_id, month_id, business_id, description, amount, status, expense_date, category_id)
select (select id from sections where code = 'admin'), m.id, proof.get('ish')::uuid, 'T98 store expenses', 753463.83, 'posted', '2025-03-15', (select id from admin_expense_categories where code = 'rent')
  from months m where m.business_id = proof.get('ish')::uuid and m.year = 2025 and m.month = 3;
-- read as the Super Admin acting as ISHABELLA (the budget figures follow the user's access)
update users set acting_business_id = proof.get('ish')::uuid where id = '00000000-0000-0000-0000-000000000001';
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.set('r', public.bo_commission_month(proof.get('m')::date)::text);
reset role; select proof.as_owner(); set local ibx.agent_override = 'on';
select proof.ok((proof.get('r')::jsonb->>'overall_gross')::numeric = 5363118.66 and (proof.get('r')::jsonb->>'net_sales')::numeric = 1192244.19
                and (proof.get('r')::jsonb->>'monthly_expenses')::numeric = 753463.83, 'gross ₱5,363,118.66, net sales ₱1,192,244.19, expenses ₱753,463.83');
select proof.ok((proof.get('r')::jsonb->>'bottomline_before')::numeric = 438780.36, 'bottomline before BO commission ₱438,780.36');
select proof.ok((proof.get('r')::jsonb->>'store_paid_gross')::numeric = 2848080.08, 'store sales ₱2,848,080.08 (walk-in account only, Ikot not in it)');
select proof.ok((proof.get('r')::jsonb->>'agent_commission')::numeric = 152734.16, 'agent commission ₱152,734.16 (Raymart not in it)');
select proof.ok((proof.get('r')::jsonb->'store_agents'->0->>'amount')::numeric = 2542.02, 'Raymart (Ikot): (₱265,250 − ₱11,048) × 1% = ₱2,542.02');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'plans') x where x->>'kind' = 'manager') = 33645.19, 'Manager (Bert) ₱33,645.19');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'plans') x where x->>'kind' = 'sales_staff') = 12239.77, 'Sales staff (Riza) ₱12,239.77');
select proof.ok((select count(*) from jsonb_array_elements(proof.get('r')::jsonb->'plans') x where x->>'kind' = 'department' and (x->>'amount')::numeric = 4387.80) = 4, 'four department pools of ₱4,387.80');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'payouts') x where x->>'name' like 'Riza%') = 14433.67, 'Riza ₱14,433.67 (sales staff + half of Admin)');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'payouts') x where x->>'name' like 'Shiena%') = 4387.80
                and (select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'payouts') x where x->>'name' like 'Glydal%') = 2193.90
                and (select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'payouts') x where x->>'name' like 'Vincent%') = 1462.60
                and (select (x->>'amount')::numeric from jsonb_array_elements(proof.get('r')::jsonb->'payouts') x where x->>'name' like 'Rod%') = 4387.80,
                'Shiena ₱4,387.80, Glydal ₱2,193.90, Vincent / Jojo / Mark ₱1,462.60, Rod ₱4,387.80');
select proof.ok((proof.get('r')::jsonb->>'back_office_with_store_agents')::numeric = 65978.18,
                'back office incl. Raymart ₱65,978.18 paid in centavos (workbook ₱65,978.20 adds unrounded amounts)');
select proof.ok(abs((proof.get('r')::jsonb->>'true_bottomline')::numeric - 372802.16) <= 0.02 and abs((proof.get('r')::jsonb->>'tithes')::numeric - 37280.22) <= 0.01,
                'true bottomline ≈ ₱372,802.16, tithes ≈ ₱37,280.22 (within rounding)');

\echo == B. PILI "% of sales"
insert into storefront_sales(id, business_id, sale_number, sale_date, status, agent_id, customer_id, location_id, subtotal, total)
select x.id::uuid, proof.get('pili')::uuid, x.n, x.d::date, 'completed', x.ag::uuid, s.walk_in_customer_id, s.location_id, x.t, x.t
  from (values ('00000000-0000-0000-0000-0000009800d1', 'T98-P-S1', '2025-03-05', public.sales_agent_store(proof.get('pili')::uuid)::text, 900000::numeric),
               ('00000000-0000-0000-0000-0000009800d2', 'T98-P-S2', '2025-03-06', (select id::text from sales_agents where agent_code = 'AG-T98R'), 300000::numeric),
               ('00000000-0000-0000-0000-0000009800d3', 'T98-P-S3', '2025-04-06', public.sales_agent_store(proof.get('pili')::uuid)::text, 500000::numeric)) x(id, n, d, ag, t)
  left join storefront_settings s on s.business_id = proof.get('pili')::uuid;
select proof.as_user('00000000-0000-0000-0000-000000000011');   -- PILI Business Admin
select proof.set('p', public.bo_commission_month('2025-03-01')::text);
select proof.ok((proof.get('p')::jsonb->>'overall_gross')::numeric = 1200000, 'PILI March: ₱1,200,000 of sales (store + Ptr Rod)');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p')::jsonb->'payouts') x where x->>'name' = 'Fred') = 18000, 'Fred: 1% sales manager ₱12,000 + 0.5% owner ₱6,000 = ₱18,000');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p')::jsonb->'payouts') x where x->>'name' like 'Rochelle%') = 6000, 'Rochelle: store manager 0.5% (quota met) ₱6,000');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p')::jsonb->'payouts') x where x->>'name' = 'Bert') = 3000, 'Bert: 1% of Ptr Rod''s ₱300,000 = ₱3,000');
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p')::jsonb->'payouts') x where x->>'name' = 'Rod') = 6000
                and (select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p')::jsonb->'payouts') x where x->>'name' = 'Vin') = 6000, 'owners Rod and Vin ₱6,000 each (0.5% each, not split)');
select proof.ok((proof.get('p')::jsonb->>'back_office_total')::numeric = 12000 + 6000 + 3000 + 18000, 'PILI total ₱39,000');
select proof.set('p2', public.bo_commission_month('2025-04-01')::text);
select proof.ok((select (x->>'amount')::numeric from jsonb_array_elements(proof.get('p2')::jsonb->'payouts') x where x->>'name' = 'Fred') = 5000
                and not exists (select 1 from jsonb_array_elements(proof.get('p2')::jsonb->'payouts') x where x->>'name' in ('Rod', 'Vin') or x->>'name' like 'Rochelle%'),
                'April ₱500,000 (quota not met): only the 1% sales manager incentive (Fred ₱5,000)');
select proof.fails($$select public.bo_commission_setup_save('{"plans":[{"kind":"sales_percent","label":"X","rate":1,"basis":"agent_gross"}]}')$$, 'choose the agent', 'an agent-based plan needs the agent');
select proof.ok(exists (select 1 from jsonb_array_elements(public.bo_commission_month('2025-03-01')->'plan_setup') x where x->>'label' = 'Owner''s Allowance' and (x->>'per_person')::boolean
                and x->'payees' ? 'Vin'), 'the set-up screen gets per-person and the payees');
\echo == C. closing PILI March: approved expenses to employees and to named payees
select proof.set('cl', public.bo_commission_close('2025-03-01')::text);
reset role; select proof.as_owner();
select proof.ok((select count(*) from bo_commission_payouts o join bo_commission_periods p on p.id = o.period_id where p.business_id = proof.get('pili')::uuid and p.period = '2025-03-01') = 5,
                'five payouts: Fred, Rochelle, Bert, Rod, Vin');
select proof.ok((select e.amount = 18000 and e.vendor = 'Fred' and e.status::text = 'approved' and e.payment_method = 'Payout'
                   from bo_commission_payouts o join expenses e on e.id = o.expense_id where o.payee = 'Fred'), 'Fred''s ₱18,000 is an approved Commission expense (named payee)');
select proof.ok((select e.payment_method = 'Payout to employee' from bo_commission_payouts o join expenses e on e.id = o.expense_id join employees m on m.id = o.employee_id where m.first_name = 'Rochelle'),
                'Rochelle is paid as an employee');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok((select count(*) from jsonb_array_elements(public.bo_commission_month('2025-03-01')->'payouts') x where x->>'name' in ('Fred', 'Bert', 'Rod', 'Vin')) = 4, 'the closed month still lists the named payees');
rollback;
