-- ============================================================================
-- Build 55 — Item ↔ supplier purchase price history.
--
-- Requirement (user, 2026-09-27): one catalog item is sourced from several
-- suppliers, each with its own item code, and for each supplier every
-- purchase keeps its date and price:
--   Item A → Supplier A (code A) → purchase A1: price, purchase A2: price
--          → Supplier B (code B) → purchase B1: price, …
-- The price is the PO price by default, and becomes the invoice price when
-- the supplier billed differently.
--
-- What existed: finance_procurement_item_suppliers (item ↔ supplier, with the
-- supplier's item code — CAT-03/04) and one hand-typed, undated
-- `last_purchase_cost` on that GLOBAL link (so one business's price would
-- show to another). Actual prices lived only on PO lines, never collected.
--
-- Design:
--   * finance_item_supplier_price_history — one row per approved PO line
--     that names a catalog item. Business-scoped (prices are a business's own
--     commercial data), created ONLY by the database when a PO becomes
--     approved, never by hand.
--   * po_unit_price is the PO price and never changes after capture.
--   * invoice_unit_price is filled automatically when AP records a supplier
--     invoice line linked to that PO line (price_source='invoice'), or by a
--     Finance user with a required reason (price_source='manual'). A manual
--     correction is not overwritten by a later invoice line (a person
--     deliberately set it); voiding the invoice clears an invoice-sourced
--     price back to the PO price.
--   * effective_unit_price = invoice price if present, else PO price.
--   * purchase_order_items.supplier_item_code snapshots the supplier's code on
--     each PO line, so the PO shows the code used even if it changes later.
-- ============================================================================

-- ------------------------------------------------ supplier code on PO line ---
alter table public.purchase_order_items add column if not exists supplier_item_code text;

create or replace function public.snapshot_po_item_supplier_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.item_id is null then
    new.supplier_item_code := null;
    return new;
  end if;
  select s.supplier_item_code into new.supplier_item_code
    from public.purchase_orders po
    join public.finance_procurement_item_suppliers s on s.supplier_id = po.supplier_id and s.item_id = new.item_id
   where po.id = new.purchase_order_id;
  return new;
end;
$$;

drop trigger if exists purchase_order_items_snapshot_supplier_code on public.purchase_order_items;
create trigger purchase_order_items_snapshot_supplier_code
before insert or update of item_id on public.purchase_order_items
for each row execute function public.snapshot_po_item_supplier_code();

-- a draft PO whose supplier is changed re-snapshots its lines' codes
create or replace function public.resnapshot_po_supplier_codes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.supplier_id is distinct from old.supplier_id then
    update public.purchase_order_items i
       set supplier_item_code = (select s.supplier_item_code from public.finance_procurement_item_suppliers s
                                  where s.supplier_id = new.supplier_id and s.item_id = i.item_id)
     where i.purchase_order_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_resnapshot_supplier_codes on public.purchase_orders;
create trigger purchase_orders_resnapshot_supplier_codes
after update of supplier_id on public.purchase_orders
for each row execute function public.resnapshot_po_supplier_codes();

update public.purchase_order_items i
   set supplier_item_code = s.supplier_item_code
  from public.purchase_orders po
  join public.finance_procurement_item_suppliers s on s.supplier_id = po.supplier_id
 where po.id = i.purchase_order_id and s.item_id = i.item_id and i.supplier_item_code is null;

-- ------------------------------------------------------------ the table ---
create table if not exists public.finance_item_supplier_price_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  item_id uuid not null references public.finance_procurement_items(id),
  supplier_id uuid not null references public.finance_suppliers(id),
  supplier_item_code text,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid not null unique references public.purchase_order_items(id) on delete cascade,
  purchase_date date not null,
  quantity numeric,
  unit text,
  po_unit_price numeric(14,2) not null check (po_unit_price >= 0),
  invoice_unit_price numeric(14,2) check (invoice_unit_price is null or invoice_unit_price >= 0),
  supplier_invoice_id uuid references public.finance_supplier_invoices(id) on delete set null,
  invoice_reference text,
  price_source text not null default 'po' check (price_source in ('po','invoice','manual')),
  effective_unit_price numeric(14,2) generated always as (coalesce(invoice_unit_price, po_unit_price)) stored,
  adjustment_note text,
  adjusted_by uuid references public.users(id),
  adjusted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_history_source_consistent check (
    (price_source = 'po' and invoice_unit_price is null)
    or (price_source = 'invoice' and invoice_unit_price is not null)
    or (price_source = 'manual' and invoice_unit_price is not null and nullif(trim(adjustment_note), '') is not null)
  )
);

create index if not exists idx_price_history_item_supplier on public.finance_item_supplier_price_history(business_id, item_id, supplier_id, purchase_date desc);
create index if not exists idx_price_history_supplier on public.finance_item_supplier_price_history(business_id, supplier_id, purchase_date desc);
create index if not exists idx_price_history_invoice on public.finance_item_supplier_price_history(supplier_invoice_id);

-- Only the invoice-price fields may change after capture: date, supplier,
-- item, quantity and the PO price are the record of what was ordered.
create or replace function public.guard_price_history_update()
returns trigger language plpgsql as $$
begin
  if new.business_id is distinct from old.business_id
     or new.item_id is distinct from old.item_id
     or new.supplier_id is distinct from old.supplier_id
     or new.supplier_item_code is distinct from old.supplier_item_code
     or new.purchase_order_id is distinct from old.purchase_order_id
     or new.purchase_order_item_id is distinct from old.purchase_order_item_id
     or new.purchase_date is distinct from old.purchase_date
     or new.quantity is distinct from old.quantity
     or new.unit is distinct from old.unit
     or new.po_unit_price is distinct from old.po_unit_price then
    raise exception 'Purchase price history is fixed at PO approval; only the invoice price can be changed.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists price_history_guard_update on public.finance_item_supplier_price_history;
create trigger price_history_guard_update
before update on public.finance_item_supplier_price_history
for each row execute function public.guard_price_history_update();

-- ------------------------------------------------------------------ RLS ---
alter table public.finance_item_supplier_price_history enable row level security;

drop policy if exists finance_item_supplier_price_history_business_isolation on public.finance_item_supplier_price_history;
create policy finance_item_supplier_price_history_business_isolation on public.finance_item_supplier_price_history
  as restrictive for all
  using (public.is_super_admin() or business_id = public.current_business_id())
  with check (public.is_super_admin() or business_id = public.current_business_id());

-- Read + invoice-price correction: Finance (same audience as purchase_orders)
-- and the admin tier. No INSERT/DELETE grant: rows are created by the
-- database at PO approval and removed only with their PO line.
drop policy if exists finance_item_supplier_price_history_finance_read on public.finance_item_supplier_price_history;
create policy finance_item_supplier_price_history_finance_read on public.finance_item_supplier_price_history
  for select using (
    public.is_super_admin() or public.is_business_admin()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
    or public.has_section_access('finance')
  );

drop policy if exists finance_item_supplier_price_history_finance_update on public.finance_item_supplier_price_history;
create policy finance_item_supplier_price_history_finance_update on public.finance_item_supplier_price_history
  for update using (
    public.is_super_admin() or public.is_business_admin()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
    or public.has_section_access('finance')
  ) with check (
    public.is_super_admin() or public.is_business_admin()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance')
    or public.has_section_access('finance')
  );

grant select, update on public.finance_item_supplier_price_history to authenticated;

-- ------------------------------------------------ capture at PO approval ---
create or replace function public.capture_po_price_history(p_po_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.finance_item_supplier_price_history(
    business_id, item_id, supplier_id, supplier_item_code, purchase_order_id, purchase_order_item_id,
    purchase_date, quantity, unit, po_unit_price)
  select po.business_id, i.item_id, po.supplier_id,
         coalesce(i.supplier_item_code, s.supplier_item_code),
         po.id, i.id, po.order_date, i.quantity, i.unit, coalesce(i.unit_cost, 0)
    from public.purchase_orders po
    join public.purchase_order_items i on i.purchase_order_id = po.id
    left join public.finance_procurement_item_suppliers s on s.supplier_id = po.supplier_id and s.item_id = i.item_id
   where po.id = p_po_id and po.supplier_id is not null and i.item_id is not null
  on conflict (purchase_order_item_id) do nothing;
end;
$$;
revoke all on function public.capture_po_price_history(uuid) from public;

create or replace function public.trg_capture_po_price_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public.capture_po_price_history(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_orders_capture_price_history on public.purchase_orders;
create trigger purchase_orders_capture_price_history
after update of status on public.purchase_orders
for each row execute function public.trg_capture_po_price_history();

-- ----------------------------------------- invoice price from AP invoices ---
create or replace function public.apply_invoice_price_to_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_number text; v_status text;
begin
  if tg_op = 'UPDATE' and old.purchase_order_item_id is not null
     and old.purchase_order_item_id is distinct from new.purchase_order_item_id then
    -- line re-pointed: release the old PO line's invoice price
    update public.finance_item_supplier_price_history
       set invoice_unit_price = null, supplier_invoice_id = null, invoice_reference = null, price_source = 'po'
     where purchase_order_item_id = old.purchase_order_item_id and supplier_invoice_id = old.invoice_id and price_source = 'invoice';
  end if;
  if new.purchase_order_item_id is null then return new; end if;
  select invoice_number, status::text into v_number, v_status from public.finance_supplier_invoices where id = new.invoice_id;
  if v_status = 'voided' then return new; end if;
  update public.finance_item_supplier_price_history
     set invoice_unit_price = new.unit_cost, supplier_invoice_id = new.invoice_id,
         invoice_reference = v_number, price_source = 'invoice'
   where purchase_order_item_id = new.purchase_order_item_id
     and price_source <> 'manual';
  return new;
end;
$$;

drop trigger if exists supplier_invoice_items_apply_price_history on public.finance_supplier_invoice_items;
create trigger supplier_invoice_items_apply_price_history
after insert or update of unit_cost, purchase_order_item_id on public.finance_supplier_invoice_items
for each row execute function public.apply_invoice_price_to_history();

create or replace function public.release_voided_invoice_prices()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'voided' and old.status is distinct from 'voided' then
    update public.finance_item_supplier_price_history
       set invoice_unit_price = null, supplier_invoice_id = null, invoice_reference = null, price_source = 'po'
     where supplier_invoice_id = new.id and price_source = 'invoice';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_invoices_release_price_history on public.finance_supplier_invoices;
create trigger supplier_invoices_release_price_history
after update of status on public.finance_supplier_invoices
for each row execute function public.release_voided_invoice_prices();

-- A linked invoice line must belong to the invoice's own PO, so an invoice
-- can never rewrite the price history of some other purchase.
create or replace function public.guard_invoice_item_po_link()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv_po uuid; v_item_po uuid;
begin
  if new.purchase_order_item_id is null then return new; end if;
  select purchase_order_id into v_inv_po from public.finance_supplier_invoices where id = new.invoice_id;
  select purchase_order_id into v_item_po from public.purchase_order_items where id = new.purchase_order_item_id;
  if v_item_po is null or v_inv_po is distinct from v_item_po then
    raise exception 'Invoice line is linked to a PO line that is not on this invoice''s purchase order.';
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_invoice_items_guard_po_link on public.finance_supplier_invoice_items;
create trigger supplier_invoice_items_guard_po_link
before insert or update of purchase_order_item_id, invoice_id on public.finance_supplier_invoice_items
for each row execute function public.guard_invoice_item_po_link();

-- ------------------------------------------------------- latest price view ---
create or replace view public.finance_item_supplier_last_price
with (security_invoker = true) as
select distinct on (business_id, item_id, supplier_id)
       business_id, item_id, supplier_id, supplier_item_code, purchase_date as last_purchase_date,
       effective_unit_price as last_unit_price, price_source, purchase_order_id
  from public.finance_item_supplier_price_history
 order by business_id, item_id, supplier_id, purchase_date desc, created_at desc;
grant select on public.finance_item_supplier_last_price to authenticated;

-- ---------------------------------------------------------------- backfill ---
-- Every PO already approved gets its history; then invoice lines already
-- linked to PO lines (none from the UI before this build, but the column
-- existed) apply their price.
do $$
declare r record;
begin
  for r in select id from public.purchase_orders where status = 'approved' loop
    perform public.capture_po_price_history(r.id);
  end loop;
end $$;

update public.finance_item_supplier_price_history h
   set invoice_unit_price = ii.unit_cost, supplier_invoice_id = ii.invoice_id,
       invoice_reference = inv.invoice_number, price_source = 'invoice'
  from public.finance_supplier_invoice_items ii
  join public.finance_supplier_invoices inv on inv.id = ii.invoice_id
 where ii.purchase_order_item_id = h.purchase_order_item_id
   and inv.status <> 'voided' and h.price_source = 'po';
