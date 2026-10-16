-- Build 113 (MODE-01 part 1: operating modes, document approval points) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
select proof.set('aton', (select id::text from businesses where code = 'ATON'));
insert into finance_customers(id, business_id, customer_code, legal_name, active, agent_id)
values ('00000000-0000-0000-0000-0000011300c1', proof.get('pili')::uuid, 'CUS-T113', 'Mode Test Client', true, public.sales_agent_store(proof.get('pili')::uuid));
create or replace function pg_temp.qstatus(p uuid) returns text language sql as $$ select status::text from public.sales_quotations where id = p $$;

-- default: no row = Full (two_step everywhere)
select proof.ok(public.workflow_point_setting(proof.get('pili')::uuid, 'quote') = 'two_step', 'a store with no mode set is Full (two-step)');

-- only the Super Admin sets a mode
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.fails($$select public.workflow_set_mode('$$ || proof.get('pili') || $$', 'single')$$, 'Only the Super Admin', 'a Business Admin cannot change the mode');
select proof.fails($$insert into business_operating_modes(business_id, mode) values ('$$ || proof.get('pili') || $$', 'single')$$, 'permission denied', 'no direct writes to the settings table');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select proof.ok((public.workflow_set_mode(proof.get('pili')::uuid, 'single')->>'mode') = 'single', 'Super Admin sets PILI to Single-operator');
select proof.ok(public.workflow_point_setting(proof.get('pili')::uuid, 'po') = 'auto' and public.workflow_point_setting(proof.get('aton')::uuid, 'po') = 'two_step', 'Single = auto for PILI; ATON unchanged');
select proof.ok(exists (select 1 from audit_log where entity_table = 'business_operating_modes' and action = 'operating_mode_changed'), 'mode change is in the audit log');

-- Single-operator: the cashier prepares a quotation; it is approved at once, by the system
select proof.as_owner();
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011300a1', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011300c1', 1000, '00000000-0000-0000-0000-000000000013');
select proof.ok((select setting from workflow_document_rules where entity_id = '00000000-0000-0000-0000-0000011300a1') = 'auto', 'the quotation records the rule it started under (auto)');
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_quotations set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300a1';
select proof.as_owner();
select proof.ok(pg_temp.qstatus('00000000-0000-0000-0000-0000011300a1') = 'approved', 'prepared → approved at once under Single-operator');
select proof.ok((select approved_by from sales_quotations where id = '00000000-0000-0000-0000-0000011300a1') = '00000000-0000-0000-0000-000000000013', 'stamped with the operator');
select proof.ok(exists (select 1 from audit_log where entity_id = '00000000-0000-0000-0000-0000011300a1' and action = 'auto_approved'
                        and detail->>'note' = 'auto-approved under Single-operator mode'), 'recorded as auto-approved under Single-operator mode');

-- a document keeps its rules: created under Single, prepared after the switch to Full
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011300a2', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011300c1', 500, '00000000-0000-0000-0000-000000000013');
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'full');
select proof.as_owner();
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011300a3', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011300c1', 700, '00000000-0000-0000-0000-000000000013');
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_quotations set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id in ('00000000-0000-0000-0000-0000011300a2', '00000000-0000-0000-0000-0000011300a3');
select proof.as_owner();
select proof.ok(pg_temp.qstatus('00000000-0000-0000-0000-0000011300a2') = 'approved', 'a quotation started under Single keeps auto after the switch');
select proof.ok(pg_temp.qstatus('00000000-0000-0000-0000-0000011300a3') = 'prepared', 'a quotation started under Full waits for review');

-- Skeletal (one_step): the Sales approver's review also approves
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'skeletal');
select proof.as_owner();
insert into sales_quotations(id, business_id, customer_id, subtotal, created_by)
values ('00000000-0000-0000-0000-0000011300a4', proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011300c1', 900, '00000000-0000-0000-0000-000000000013');
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_quotations set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300a4';
select proof.as_owner();
select proof.ok(pg_temp.qstatus('00000000-0000-0000-0000-0000011300a4') = 'prepared', 'Skeletal: still needs a second person');
select proof.as_user('00000000-0000-0000-0000-000000000014');
update sales_quotations set status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now() where id = '00000000-0000-0000-0000-0000011300a4';
select proof.as_owner();
select proof.ok(pg_temp.qstatus('00000000-0000-0000-0000-0000011300a4') = 'approved', 'Skeletal: the approver''s review approves in the same step');
select proof.ok((select approved_by from sales_quotations where id = '00000000-0000-0000-0000-0000011300a4') = '00000000-0000-0000-0000-000000000014', 'approved by the approver, not the preparer');

-- Custom: PR auto, PO two-step; Finance user, RA-06 guard still in force for manual steps
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'custom', '{"pr":"auto","po":"two_step"}'::jsonb);
select proof.ok(public.workflow_point_setting(proof.get('pili')::uuid, 'quote') = 'two_step' and public.workflow_point_setting(proof.get('pili')::uuid, 'pr') = 'auto', 'Custom keeps the chosen settings, others two-step');
select proof.fails($$select public.workflow_set_mode('$$ || proof.get('pili') || $$', 'custom', '{"pr":"sometimes"}')$$, 'Unknown setting', 'an unknown setting is refused');
select proof.as_owner();
insert into purchase_requisitions(id, business_id, requested_by, purpose, status)
values ('00000000-0000-0000-0000-0000011300b1', proof.get('pili')::uuid, '00000000-0000-0000-0000-000000000015', 'Mode test PR', 'draft');
select proof.as_user('00000000-0000-0000-0000-000000000015');
update purchase_requisitions set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300b1';
select proof.as_owner();
select proof.ok((select status::text from purchase_requisitions where id = '00000000-0000-0000-0000-0000011300b1') = 'approved', 'Custom: the PR is auto-approved past the RA-06 guard');
insert into purchase_orders(id, business_id, supplier_id, order_date, status)
values ('00000000-0000-0000-0000-0000011300b2', proof.get('pili')::uuid, '30000000-0000-0000-0000-000000000001', current_date, 'draft');
insert into purchase_order_items(business_id, purchase_order_id, description, quantity, unit, unit_cost)
values (proof.get('pili')::uuid, '00000000-0000-0000-0000-0000011300b2', 'Capacitor', 1, 'pc', 40);
select proof.as_user('00000000-0000-0000-0000-000000000015');
update purchase_orders set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300b2';
update purchase_orders set status = 'reviewed' where id = '00000000-0000-0000-0000-0000011300b2';
select proof.ok((select status::text from purchase_orders where id = '00000000-0000-0000-0000-0000011300b2') = 'reviewed', 'Custom: the PO stays two-step (reviewed, not approved)');
select proof.fails($$update purchase_orders set status = 'approved' where id = '00000000-0000-0000-0000-0000011300b2'$$, 'another approver must approve', 'two-step still refuses self-approval');
-- Sales order under auto: the sales approver check does not block the system step
select proof.as_owner();
select proof.ok((select count(*) from workflow_document_rules where business_id = proof.get('pili')::uuid) >= 6, 'every new document has its rule snapshot');
select proof.as_user('00000000-0000-0000-0000-000000000013');
select proof.ok(jsonb_array_length(public.workflow_recent_auto_approvals(7)) = 0, 'staff do not see the auto-approval list');
select proof.as_user('00000000-0000-0000-0000-000000000011');
select proof.ok(jsonb_array_length(public.workflow_recent_auto_approvals(7)) >= 3, 'the Business Admin sees recent auto / one-step approvals');
select proof.ok((select count(*) from jsonb_array_elements(public.workflow_modes())) = 1, 'a Business Admin sees only their own store''s mode');
-- Single-operator for a sales order and an expense (the Sales-approver check and the expense step-by-step guard)
select proof.as_user('00000000-0000-0000-0000-000000000001');
select public.workflow_set_mode(proof.get('pili')::uuid, 'single');
select proof.as_owner();
insert into sales_orders(id, business_id, order_number, customer_id, status)
values ('00000000-0000-0000-0000-0000011300d1', proof.get('pili')::uuid, 'x', '00000000-0000-0000-0000-0000011300c1', 'draft');
select proof.as_user('00000000-0000-0000-0000-000000000013');
update sales_orders set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300d1';
select proof.as_owner();
select proof.ok((select status::text from sales_orders where id = '00000000-0000-0000-0000-0000011300d1') = 'approved', 'Single: a sales order prepared by a cashier (not a Sales approver) is auto-approved');
insert into months(id, business_id, year, month, label) values ('00000000-0000-0000-0000-0000011300e0', proof.get('pili')::uuid, 2031, 1, 'January 2031') on conflict do nothing;
insert into expenses(id, business_id, section_id, month_id, description, amount, status, prepared_by)
values ('00000000-0000-0000-0000-0000011300e1', proof.get('pili')::uuid, (select id from sections where code = 'logistics'), '00000000-0000-0000-0000-0000011300e0', 'Mode test expense', 100, 'draft', '00000000-0000-0000-0000-000000000016');
select proof.as_user('00000000-0000-0000-0000-000000000016');
update expenses set status = 'prepared', prepared_by = auth.uid(), prepared_at = now() where id = '00000000-0000-0000-0000-0000011300e1';
select proof.as_owner();
select proof.ok((select status::text from expenses where id = '00000000-0000-0000-0000-0000011300e1') = 'approved', 'Single: an expense is auto-approved through each step (posting stays separate)');
rollback;
