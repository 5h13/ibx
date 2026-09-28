-- IBX Finance Accounts Payable foundation
-- Supplier invoices, invoice lines, payment records and AP status/aging foundation.

create type public.ap_invoice_status as enum ('draft','prepared','reviewed','approved','partially_paid','paid','voided');
create type public.ap_payment_status as enum ('draft','prepared','reviewed','approved','posted','voided');

create table if not exists public.finance_supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  supplier_id uuid not null references public.finance_suppliers(id),
  purchase_order_id uuid references public.purchase_orders(id),
  invoice_date date not null,
  due_date date,
  currency text not null default 'PHP',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (subtotal + tax_amount + other_charges) stored,
  amount_paid numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due numeric(14,2) generated always as ((subtotal + tax_amount + other_charges) - amount_paid) stored,
  status public.ap_invoice_status not null default 'draft',
  notes text,
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(supplier_id, invoice_number)
);

create table if not exists public.finance_supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.finance_supplier_invoices(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id),
  description text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit text not null default 'unit',
  unit_cost numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * unit_cost) stored,
  notes text
);

create table if not exists public.finance_supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payment_number text unique not null,
  invoice_id uuid not null references public.finance_supplier_invoices(id),
  payment_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null default 'Bank transfer',
  reference_number text,
  bank_account text,
  notes text,
  status public.ap_payment_status not null default 'draft',
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  posted_by uuid references public.users(id), posted_at timestamptz,
  created_by uuid references public.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create index if not exists idx_ap_invoice_supplier on public.finance_supplier_invoices(supplier_id, invoice_date desc);
create index if not exists idx_ap_invoice_status on public.finance_supplier_invoices(status, due_date);
create index if not exists idx_ap_invoice_po on public.finance_supplier_invoices(purchase_order_id);
create index if not exists idx_ap_invoice_items_invoice on public.finance_supplier_invoice_items(invoice_id);
create index if not exists idx_ap_payment_invoice on public.finance_supplier_payments(invoice_id, payment_date desc);
create index if not exists idx_ap_payment_status on public.finance_supplier_payments(status, payment_date desc);

alter table public.finance_supplier_invoices enable row level security;
alter table public.finance_supplier_invoice_items enable row level security;
alter table public.finance_supplier_payments enable row level security;

create policy "finance AP invoices access" on public.finance_supplier_invoices for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);
create policy "finance AP invoice items access" on public.finance_supplier_invoice_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);
create policy "finance AP payments access" on public.finance_supplier_payments for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);

create or replace function public.recalculate_supplier_invoice_paid(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_paid numeric(14,2);
begin
  select coalesce(sum(amount),0) into v_paid from public.finance_supplier_payments where invoice_id=p_invoice_id and status='posted';
  update public.finance_supplier_invoices
  set amount_paid=v_paid,
      status=case when status='voided' then status when v_paid >= total_amount then 'paid'::public.ap_invoice_status when v_paid > 0 then 'partially_paid'::public.ap_invoice_status else status end,
      updated_at=now()
  where id=p_invoice_id;
end; $$;
