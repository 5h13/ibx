-- Build 116 (MODE-01 part 2: Storefront under Single-operator) proof. Runs after proofs 78-115. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_user(proof.get('SA')::uuid);
select public.workflow_set_mode(proof.get('PILI')::uuid, 'single');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok((public.workflow_store_points()->>'returns') = 'auto' and (public.workflow_store_points()->>'dr_release') = 'auto', 'the Storefront sees its Single-operator settings');

-- below the 7% floor but at or above 3% over cost: completes with a warning (Compressor A lot ₱100: floor 107, 3% = 103)
select proof.set('M1', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'), 'unit_price', 105)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 105)), 'issue_dr', true))->>'id'));
select proof.as_owner();
select proof.ok((select status from storefront_sales where id = proof.get('M1')::uuid) = 'completed', 'below the floor (105 < 107): completed, no approver');
select proof.ok(exists (select 1 from workflow_warnings where entity_id = proof.get('M1')::uuid and kind = 'counter_sale' and detail->'reasons' ? 'below_floor'), 'and a below-floor warning is on its record');
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', '$$ || proof.get('a100') || $$', 'unit_price', 102)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 102)), 'issue_dr', true))$$, 'below 3% over its cost', 'below 3% over cost (102 < 103) is refused');

-- late entry: completes with a warning
select proof.set('M2', (storefront_submit_sale(jsonb_build_object('sale_date', current_date - 1, 'late_reason', 'encoded next morning',
        'lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'))),
        'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 120, 'reference', 'CARD-777')), 'issue_dr', true))->>'id'));
select proof.as_owner();
select proof.ok((select status from storefront_sales where id = proof.get('M2')::uuid) = 'completed'
                and exists (select 1 from workflow_warnings where entity_id = proof.get('M2')::uuid and detail->'reasons' ? 'late_entry'), 'late entry: completed with a warning');

-- a reference used twice is refused, even for an approver
select proof.as_user(proof.get('SAPP')::uuid);
select proof.fails($$select storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', '$$ || proof.get('a100') || $$')),
        'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 120, 'reference', 'card 777')), 'issue_dr', true))$$, 'cannot be used twice', 'a reused card reference is refused (even for the Sales approver)');

-- refund in cash for a card payment is refused; a card refund goes through
select proof.as_user(proof.get('CASH')::uuid);
select proof.fails($$select storefront_return(jsonb_build_object('sale_id', '$$ || proof.get('M2') || $$', 'reason', 'defective',
        'lines', jsonb_build_array(jsonb_build_object('sale_item_id', (select id from storefront_sale_items where sale_id = '$$ || proof.get('M2') || $$'), 'quantity', 1, 'condition', 'damaged')),
        'refunds', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 120))))$$, 'refunds go back the way the customer paid', 'cash refund of a card payment is refused');
select storefront_return(jsonb_build_object('sale_id', proof.get('M2'), 'reason', 'defective',
        'lines', jsonb_build_array(jsonb_build_object('sale_item_id', (select id from storefront_sale_items where sale_id = proof.get('M2')::uuid), 'quantity', 1, 'condition', 'damaged')),
        'refunds', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 120, 'reference', 'RF-1'))));
select proof.ok(true, 'the same return refunded to the card goes through');

-- cancelling a completed sale is refused (use Return)
select proof.fails($$select storefront_request_cancel('$$ || proof.get('M1') || $$', 'customer changed mind')$$, 'use Return', 'cancel a completed sale is refused; Return is the way');

-- order DR: released with the DR
select proof.set('MDR', (storefront_order_dr(jsonb_build_object('order_id', '53000000-0000-0000-0000-000000000001', 'lines', jsonb_build_array(
        jsonb_build_object('sales_order_item_id', '54000000-0000-0000-0000-000000000001', 'quantity', 1)))))->>'id');
select proof.as_owner();
select proof.ok((select release_status = 'released' and released_by = proof.get('CASH')::uuid from storefront_sales where id = proof.get('MDR')::uuid), 'order DR released at once, by the person who issued it');
select proof.ok(exists (select 1 from logistics_stock_movements where source_table = 'storefront_sales' and source_record_id = proof.get('MDR')::uuid and notes like 'Released with the DR (Single-operator mode)%'), 'the stock leaves with the DR and the movement says so');

-- daily closing: approved when submitted (or kept submitted with a warning if it cannot post)
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('CL', (storefront_close_day((now() at time zone 'Asia/Manila')::date, 999999)->>'id'));
select proof.as_owner();
select proof.ok((select status from storefront_closings where id = proof.get('CL')::uuid) = 'approved'
                or exists (select 1 from workflow_warnings where entity_id = proof.get('CL')::uuid and kind = 'closing_not_posted'), 'closing auto-approved (or warned that it could not post)');
select proof.ok(exists (select 1 from workflow_warnings where entity_id = proof.get('CL')::uuid), 'the closing''s cash difference is warned');

-- the dashboard list: Business Admin yes, cashier no; Full mode unchanged
select proof.as_user(proof.get('BA')::uuid);
select proof.ok(jsonb_array_length(public.workflow_recent_warnings(7)) >= 3, 'the Business Admin sees the warnings');
select proof.as_user(proof.get('CASH')::uuid);
select proof.ok(jsonb_array_length(public.workflow_recent_warnings(7)) = 0, 'a cashier does not');
select proof.as_user(proof.get('SA')::uuid);
select public.workflow_set_mode(proof.get('PILI')::uuid, 'full');
select proof.as_user(proof.get('CASH')::uuid);
select proof.set('M3', (storefront_submit_sale(jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('item_id', '40000000-0000-0000-0000-000000000011', 'quantity', 1, 'lot_id', proof.get('a100'), 'unit_price', 105)),
        'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 105)), 'issue_dr', true))->>'id'));
select proof.as_owner();
select proof.ok((select status from storefront_sales where id = proof.get('M3')::uuid) = 'pending_approval', 'back in Full mode, below the floor waits for an approver again');
rollback;
