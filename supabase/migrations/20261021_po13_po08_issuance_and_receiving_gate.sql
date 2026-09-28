-- PO-13 (Resolved: record when, by whom, AND HOW the PO was issued) and
-- PO-08 (Resolved: Approved -> Open/Issued -> Receiving, with receipt
-- status downstream) closure pass.
--
-- PO-13 gap found: `issue_purchase_order` (Build 30, migration
-- 20260926_consolidated_logistics_workflow_integrity.sql) already records
-- issued_at/issued_by but never captured the issuance *method* the agreed
-- resolution also asks for (e.g. email, courier, supplier portal, hand
-- delivered). Adding it here, additive only.
--
-- PO-08 gap found: issuance_status/issue_purchase_order exist, but nothing
-- actually required a PO to reach 'issued' before Logistics could receive
-- against it — src/modules/logistics/inventoryActions.ts checked only
-- purchase_orders.status (draft/prepared/reviewed/approved), and its two
-- extra branches for 'issued'/'open' were dead code: those strings are not
-- members of the `entry_status` enum `status` is typed as, so they could
-- never match. The real gate needs to check `issuance_status` instead. That
-- app-side fix accompanies this migration; this file only adds the column
-- issue_purchase_order needs to accept and record the method.

alter table public.purchase_orders add column if not exists issuance_method text;

create or replace function public.issue_purchase_order(p_po_id uuid, p_actor uuid, p_method text default null)
returns void language plpgsql security definer set search_path=public as $$
declare p record;
begin
  select * into p from public.purchase_orders where id=p_po_id for update;
  if not found then raise exception 'Purchase order not found.'; end if;
  if p.status <> 'approved' then raise exception 'Only an approved purchase order may be issued.'; end if;
  if p.issuance_status='issued' then return; end if;
  if p_method is null or length(trim(p_method))=0 then raise exception 'Issuance method is required (e.g. email, courier, supplier portal, hand delivered).'; end if;
  update public.purchase_orders
  set issuance_status='issued', issued_at=now(), issued_by=p_actor, issuance_method=p_method, updated_at=now()
  where id=p.id;
end $$;
revoke all on function public.issue_purchase_order(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_purchase_order(uuid, uuid, text) to service_role;

-- The old 2-arg overload is dropped so every caller is forced onto the
-- method-carrying signature — a PO can no longer be issued without
-- recording how, closing the PO-13 gap rather than leaving a silent
-- bypass alongside the new one.
drop function if exists public.issue_purchase_order(uuid, uuid);
