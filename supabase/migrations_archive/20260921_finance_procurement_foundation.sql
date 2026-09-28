-- IBX Finance + Procurement foundation
-- Supplier master, procurement catalog, purchase requisitions and purchase orders.

create table if not exists public.finance_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text unique not null,
  legal_name text not null,
  trade_name text,
  contact_person text,
  email text,
  phone text,
  address text,
  tax_id text,
  payment_terms text,
  bank_details text,
  active boolean not null default true,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_procurement_items (
  id uuid primary key default gen_random_uuid(),
  item_code text unique not null,
  item_name text not null,
  description text,
  category text,
  unit text not null default 'unit',
  default_supplier_id uuid references public.finance_suppliers(id),
  standard_cost numeric(14,2) not null default 0,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_requisitions (
  id uuid primary key default gen_random_uuid(),
  pr_number text unique not null,
  requested_by uuid references public.users(id),
  requested_for_employee_id uuid references public.employees(id),
  department text,
  needed_by date,
  purpose text not null,
  notes text,
  currency text not null default 'PHP',
  estimated_total numeric(14,2) not null default 0,
  status entry_status not null default 'draft',
  rejection_reason text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_requisition_items (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.purchase_requisitions(id) on delete cascade,
  item_id uuid references public.finance_procurement_items(id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'unit',
  estimated_unit_cost numeric(14,2) not null default 0,
  estimated_amount numeric(14,2) generated always as (quantity * estimated_unit_cost) stored,
  notes text
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text unique not null,
  requisition_id uuid references public.purchase_requisitions(id),
  supplier_id uuid not null references public.finance_suppliers(id),
  order_date date not null default current_date,
  expected_delivery_date date,
  delivery_address text,
  currency text not null default 'PHP',
  subtotal numeric(14,2) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  other_charges numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (subtotal + tax_amount + other_charges) stored,
  payment_terms text,
  notes text,
  status entry_status not null default 'draft',
  rejection_reason text,
  prepared_by uuid references public.users(id),
  prepared_at timestamptz,
  reviewed_by uuid references public.users(id),
  reviewed_at timestamptz,
  approved_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid references public.finance_procurement_items(id),
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null default 'unit',
  unit_cost numeric(14,2) not null default 0,
  amount numeric(14,2) generated always as (quantity * unit_cost) stored,
  notes text
);

create index if not exists idx_finance_suppliers_active on public.finance_suppliers(active, legal_name);
create index if not exists idx_procurement_items_active on public.finance_procurement_items(active, item_name);
create index if not exists idx_pr_status on public.purchase_requisitions(status, created_at desc);
create index if not exists idx_pr_items_requisition on public.purchase_requisition_items(requisition_id);
create index if not exists idx_po_status on public.purchase_orders(status, created_at desc);
create index if not exists idx_po_supplier on public.purchase_orders(supplier_id, order_date desc);
create index if not exists idx_po_items_order on public.purchase_order_items(purchase_order_id);

alter table public.finance_suppliers enable row level security;
alter table public.finance_procurement_items enable row level security;
alter table public.purchase_requisitions enable row level security;
alter table public.purchase_requisition_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

-- Finance section access. Super Admin is covered by is_super_admin().
create policy "finance suppliers access" on public.finance_suppliers for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
create policy "finance procurement items access" on public.finance_procurement_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
create policy "finance PR access" on public.purchase_requisitions for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
create policy "finance PR items access" on public.purchase_requisition_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
create policy "finance PO access" on public.purchase_orders for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);
create policy "finance PO items access" on public.purchase_order_items for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or exists (select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='finance')
);

create policy "finance can read employees" on public.employees for select using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='finance' or public.in_section((select id from public.sections where code='finance'))
);

insert into public.finance_suppliers (supplier_code, legal_name, trade_name, payment_terms, notes)
select 'SUP-001', 'Sample Supplier — replace before production', 'Sample Supplier', '30 days', 'Seeded procurement supplier for initial setup.'
where not exists (select 1 from public.finance_suppliers where supplier_code='SUP-001');
