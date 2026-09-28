-- ============================================================================
-- Build 53 — (A) view business isolation, (B) U049 supplier lifecycle
-- enforcement, (C) SUP-10 per-supplier purchase history.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) Views. A Postgres view runs with its OWNER's rights unless
-- security_invoker is set, so RLS on the underlying tables did not apply to
-- any of the six public views: verified directly — an Aton finance user saw
-- 0 rows in logistics_stock_movements but Pili's movement through
-- logistics_stock_balance / logistics_stock_ledger_running, and Pili's
-- inventory rows through logistics_inventory_status.
-- ----------------------------------------------------------------------------
alter view public.logistics_stock_balance         set (security_invoker = true);
alter view public.logistics_stock_ledger_running  set (security_invoker = true);
alter view public.logistics_inventory_status      set (security_invoker = true);
alter view public.finance_expense_history         set (security_invoker = true);
-- SUP-09's exposure view: supplier master is global, invoices are business-
-- scoped — with invoker rights, exposure is computed from the caller's own
-- business's unpaid invoices (the Global Super Admin still sees the total).
alter view public.finance_supplier_credit_exposure set (security_invoker = true);

-- finance_catalog_pricing_recovery is read by Finance (Cost Centers, CC-05;
-- Procurement dashboard, CAT-22) but is built from sales_quotations, which
-- Finance has no RLS read grant on — invoker rights would blank it. It keeps
-- owner rights and filters by business explicitly instead; business_id is
-- appended as the last column (CREATE OR REPLACE VIEW can only add at the end).
create or replace view public.finance_catalog_pricing_recovery as
 select date_trunc('month', q.quotation_date::timestamp with time zone)::date as period_start,
    coalesce(i.category, 'Uncategorized') as category,
    coalesce(i.item_type, 'product') as item_type,
    sum(qi.quantity * case when i.item_type = 'service' then coalesce(i.service_cost_basis, 0) else coalesce(qi.pricing_acquisition_cost, 0) end) as cost_basis_value,
    sum(qi.quantity * greatest(coalesce(qi.pricing_srp, qi.unit_price, 0) -
        case when i.item_type = 'service' then coalesce(i.service_cost_basis, 0) * (1 + coalesce(qi.pricing_category_addon_percent, 0) / 100)
             else coalesce(qi.pricing_acquisition_cost, 0) end, 0)) as gross_pricing_recovery,
    sum(qi.quantity * coalesce(qi.unit_price, 0)) as quoted_value,
    q.business_id
   from public.sales_quotations q
     join public.sales_quotation_items qi on qi.quotation_id = q.id
     left join public.finance_procurement_items i on i.id = qi.catalog_item_id
  where q.status = any (array['approved'::sales_quotation_status, 'sent'::sales_quotation_status, 'accepted'::sales_quotation_status])
    and qi.catalog_item_id is not null and qi.pricing_snapshot_at is not null
    and (public.is_super_admin() or q.business_id = public.current_business_id())
  group by 1, 2, 3, q.business_id;

-- ----------------------------------------------------------------------------
-- (B) U049 Supplier Lifecycle. `finance_suppliers.active` (global) and
-- SUP-05's per-business relationship status both existed, but nothing
-- server-side enforced either: the PO forms only hide globally-inactive
-- suppliers (not business-inactive ones), and createPurchaseOrderAction /
-- createPurchaseOrderFromRequisitionAction accept any supplier_id. Enforced
-- here on INSERT and on a supplier change only, so existing POs against a
-- supplier deactivated later are untouched.
-- ----------------------------------------------------------------------------
create or replace function public.guard_po_supplier_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_active boolean; v_rel text;
begin
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id then
    return new;
  end if;
  if new.supplier_id is null then return new; end if;
  select active into v_active from public.finance_suppliers where id = new.supplier_id;
  if v_active is distinct from true then
    raise exception 'Supplier is inactive and cannot be used on a new purchase order.';
  end if;
  select status into v_rel from public.finance_supplier_business_relationships
   where supplier_id = new.supplier_id and business_id = new.business_id;
  if v_rel = 'inactive' then
    raise exception 'Supplier is marked inactive for this business and cannot be used on a new purchase order.';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_guard_supplier_active on public.purchase_orders;
create trigger purchase_orders_guard_supplier_active
before insert or update of supplier_id on public.purchase_orders
for each row execute function public.guard_po_supplier_active();

-- ----------------------------------------------------------------------------
-- (C) SUP-10 per-supplier purchasing history: YTD purchase value, purchase
-- count, last purchase, and payment information/status — per business.
-- security_invoker so RLS on purchase_orders / supplier invoices / payments
-- decides what each viewer sees (a business sees only its own dealings with
-- the shared supplier; the Global Super Admin sees one row per business).
-- "Purchases" = approved POs (the committed supplier-order stage; drafts and
-- in-review POs are not purchases yet).
-- ----------------------------------------------------------------------------
create or replace view public.finance_supplier_purchase_history
with (security_invoker = true) as
with po as (
  select business_id, supplier_id,
         count(*) filter (where status = 'approved') as po_count_total,
         count(*) filter (where status = 'approved' and order_date >= date_trunc('year', current_date)) as po_count_ytd,
         coalesce(sum(total_amount) filter (where status = 'approved' and order_date >= date_trunc('year', current_date)), 0)::numeric(14,2) as ytd_purchase_value,
         coalesce(sum(total_amount) filter (where status = 'approved'), 0)::numeric(14,2) as lifetime_purchase_value,
         max(order_date) filter (where status = 'approved') as last_purchase_date,
         count(*) filter (where status in ('draft','prepared','reviewed')) as po_in_progress
    from public.purchase_orders
   where supplier_id is not null
   group by business_id, supplier_id
), inv as (
  select business_id, supplier_id,
         coalesce(sum(total_amount) filter (where status <> 'voided'), 0)::numeric(14,2) as invoiced_total,
         coalesce(sum(amount_paid) filter (where status <> 'voided'), 0)::numeric(14,2) as paid_total,
         coalesce(sum(greatest(balance_due, 0)) filter (where status not in ('voided','paid')), 0)::numeric(14,2) as outstanding_balance,
         count(*) filter (where status not in ('voided','paid') and balance_due > 0) as open_invoice_count,
         count(*) filter (where status not in ('voided','paid') and balance_due > 0 and due_date < current_date) as overdue_invoice_count,
         min(due_date) filter (where status not in ('voided','paid') and balance_due > 0) as next_due_date
    from public.finance_supplier_invoices
   group by business_id, supplier_id
), pay as (
  select i.business_id, i.supplier_id, max(p.payment_date) as last_payment_date
    from public.finance_supplier_payments p
    join public.finance_supplier_invoices i on i.id = p.invoice_id
   where p.status = 'posted'
   group by i.business_id, i.supplier_id
)
select coalesce(po.business_id, inv.business_id) as business_id,
       coalesce(po.supplier_id, inv.supplier_id) as supplier_id,
       coalesce(po.po_count_total, 0) as po_count_total,
       coalesce(po.po_count_ytd, 0) as po_count_ytd,
       coalesce(po.ytd_purchase_value, 0)::numeric(14,2) as ytd_purchase_value,
       coalesce(po.lifetime_purchase_value, 0)::numeric(14,2) as lifetime_purchase_value,
       po.last_purchase_date,
       coalesce(po.po_in_progress, 0) as po_in_progress,
       coalesce(inv.invoiced_total, 0)::numeric(14,2) as invoiced_total,
       coalesce(inv.paid_total, 0)::numeric(14,2) as paid_total,
       coalesce(inv.outstanding_balance, 0)::numeric(14,2) as outstanding_balance,
       coalesce(inv.open_invoice_count, 0) as open_invoice_count,
       coalesce(inv.overdue_invoice_count, 0) as overdue_invoice_count,
       inv.next_due_date,
       pay.last_payment_date,
       case
         when coalesce(inv.overdue_invoice_count, 0) > 0 then 'overdue'
         when coalesce(inv.outstanding_balance, 0) > 0 then 'open_balance'
         when coalesce(inv.invoiced_total, 0) > 0 then 'fully_paid'
         else 'no_invoices'
       end as payment_status
  from po
  full join inv on inv.business_id = po.business_id and inv.supplier_id = po.supplier_id
  left join pay on pay.business_id = coalesce(po.business_id, inv.business_id)
               and pay.supplier_id = coalesce(po.supplier_id, inv.supplier_id);

grant select on public.finance_supplier_purchase_history to authenticated;
