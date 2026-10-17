-- Build 136c (shop: Available / By order) proof. Rolled back.
\set ON_ERROR_STOP 1
begin;
select proof.as_owner();
select proof.set('pili', (select id::text from businesses where code = 'PILI'));
update shop_settings set enabled = true where business_id = proof.get('pili')::uuid;
update finance_procurement_items set photo_path = 'p/' || id where active;
-- an item PILI holds in stock, and one it does not
select proof.set('stocked', (select inv.procurement_item_id::text from logistics_inventory_items inv join logistics_stock_balance bal on bal.inventory_item_id = inv.id
                             join finance_procurement_items i on i.id = inv.procurement_item_id and i.active and i.item_type <> 'service'
                            where inv.business_id = proof.get('pili')::uuid and bal.on_hand > 0 limit 1));
select proof.set('none', (select i.id::text from finance_procurement_items i where i.active and i.item_type <> 'service'
                            and not exists (select 1 from logistics_inventory_items inv join logistics_stock_balance bal on bal.inventory_item_id = inv.id
                                             where inv.procurement_item_id = i.id and inv.business_id = proof.get('pili')::uuid and bal.on_hand > 0) limit 1));
select set_config('request.jwt.uid', '', false); set role anon;
select proof.ok(proof.get('stocked') = '' or (public.shop_item('pili', proof.get('stocked')::uuid)->>'available')::boolean, 'an item in stock shows as Available');
select proof.ok(not (public.shop_item('pili', proof.get('none')::uuid)->>'available')::boolean, 'an item with no stock shows as By order');
select proof.ok(not exists (select 1 from public.shop_catalog('pili', null, null, null, null, 60, 0) c where c.item_id = proof.get('none')::uuid and c.available), 'the list agrees');
select proof.ok(not (public.shop_item('pili', proof.get('none')::uuid) ?| array['on_hand', 'available_qty', 'quantity']), 'no quantity is shown');
select proof.ok(exists (select 1 from public.shop_catalog_by_category('pili', 12)), 'the front page still loads');
rollback;
