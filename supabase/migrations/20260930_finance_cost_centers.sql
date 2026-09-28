-- Finance Cost Centers: Finance-owned master and expense assignment/reporting.
create table if not exists public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expenses add column if not exists cost_center_id uuid references public.finance_cost_centers(id) on delete set null;
create index if not exists expenses_cost_center_date_idx on public.expenses(cost_center_id, expense_date desc);
create index if not exists finance_cost_centers_active_idx on public.finance_cost_centers(active, name);

alter table public.finance_cost_centers enable row level security;
drop policy if exists finance_cost_centers_select on public.finance_cost_centers;
create policy finance_cost_centers_select on public.finance_cost_centers
for select using (public.is_super_admin() or public.has_section_access('finance'));
drop policy if exists finance_cost_centers_write on public.finance_cost_centers;
create policy finance_cost_centers_write on public.finance_cost_centers
for all using (public.is_super_admin() or public.has_section_access('finance'))
with check (public.is_super_admin() or public.has_section_access('finance'));

insert into public.finance_cost_centers(code,name,description)
values
 ('ADMIN','Administration','General administration and corporate overhead'),
 ('SALES','Sales','Sales and commercial operations'),
 ('PROCUREMENT','Procurement','Procurement and supplier operations'),
 ('LOGISTICS','Logistics','Warehouse, delivery and physical operations'),
 ('FINANCE','Finance','Finance and accounting operations')
on conflict(code) do nothing;
