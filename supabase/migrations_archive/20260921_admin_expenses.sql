-- IBX Admin Expenses: richer admin-specific expense register on top of shared expenses.
-- Keeps the shared workflow/status model compatible with Finance/Logistics/Marketing/Sales.

create table if not exists public.admin_expense_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.expenses add column if not exists expense_date date;
alter table public.expenses add column if not exists category_id uuid references public.admin_expense_categories(id) on delete set null;
alter table public.expenses add column if not exists vendor text;
alter table public.expenses add column if not exists payment_method text;
alter table public.expenses add column if not exists reference_no text;
alter table public.expenses add column if not exists receipt_reference text;
alter table public.expenses add column if not exists asset_id uuid references public.assets(id) on delete set null;
alter table public.expenses add column if not exists fleet_vehicle_id uuid references public.fleet_vehicles(id) on delete set null;
alter table public.expenses add column if not exists supply_request_id uuid references public.internal_requests(id) on delete set null;
alter table public.expenses add column if not exists rejection_reason text;

update public.expenses set expense_date = coalesce(expense_date, created_at::date) where expense_date is null;
alter table public.expenses alter column expense_date set default current_date;

create index if not exists expenses_admin_date_idx on public.expenses(section_id, expense_date desc);
create index if not exists expenses_admin_category_idx on public.expenses(category_id);
create index if not exists expenses_admin_vendor_idx on public.expenses(vendor);

insert into public.admin_expense_categories(code,name,description)
values
 ('office_operations','Office Operations','Routine office and administrative operating expenses'),
 ('utilities','Utilities','Electricity, water, internet, telephone and similar services'),
 ('rent','Rent & Premises','Office rent, building charges and premises costs'),
 ('transportation','Transportation','Local transport, fares and administrative travel'),
 ('supplies','Office Supplies','Administrative consumables and office supplies'),
 ('repairs','Repairs & Maintenance','Repairs and maintenance of office property/equipment'),
 ('fleet','Fleet','Administrative vehicle-related costs not captured by fleet expense records'),
 ('licenses','Licenses & Compliance','Licenses, permits, registrations and compliance costs'),
 ('training','Training','Administrative training and development'),
 ('communication','Communication','Postage, courier, communications and related costs'),
 ('miscellaneous','Miscellaneous','Other approved administrative expenses')
on conflict (code) do nothing;

alter table public.admin_expense_categories enable row level security;
drop policy if exists admin_expense_categories_admin on public.admin_expense_categories;
create policy admin_expense_categories_admin on public.admin_expense_categories
for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')))
with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
