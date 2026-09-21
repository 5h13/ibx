-- ============================================================================
-- IBX — Ishabella Aircon & Refrigeration: Commission & Sales Management System
-- Supabase PostgreSQL schema
--
-- Workflow: Prepare -> Review -> Approve
-- Access model: department (section) + workflow role (preparer/reviewer/approver)
-- Super Admin bypasses RLS entirely.
--
-- Run this in the Supabase SQL editor (or via `supabase db push`) on a fresh
-- project, then run seed-users.mjs to create the 4 test accounts.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Enums
-- ----------------------------------------------------------------------------

-- Department role: which module a user's account is scoped to.
-- super_admin is not tied to a single section and bypasses RLS.
create type app_role as enum (
  'super_admin',
  'admin',
  'finance',
  'logistics',
  'marketing',
  'sales'
);

-- Workflow stage role: what action a user may take on an entry within
-- their assigned section. A user can hold more than one (see user_access).
create type workflow_role as enum (
  'preparer',
  'reviewer',
  'approver'
);

-- Entry lifecycle. draft = being worked on by a preparer, not yet submitted.
create type entry_status as enum (
  'draft',
  'prepared',
  'reviewed',
  'approved'
);

-- ----------------------------------------------------------------------------
-- 2. Core identity tables
-- ----------------------------------------------------------------------------

-- 2.1 sections — the departments/modules (5.2 in the build plan)
create table public.sections (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,        -- 'admin' | 'finance' | 'logistics' | 'marketing' | 'sales'
  name        text not null,
  created_at  timestamptz not null default now()
);

-- 2.2 users — mirrors auth.users, stores identity + department role (5.1)
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        app_role not null default 'sales',
  section_id  uuid references public.sections(id),   -- home section; null for super_admin
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 2.3 user_access — granular workflow permissions per user per section (5.3)
-- A user can be a preparer in Sales and a reviewer in Marketing, for example.
create table public.user_access (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  section_id     uuid not null references public.sections(id) on delete cascade,
  workflow_role  workflow_role not null,
  created_at     timestamptz not null default now(),
  unique (user_id, section_id, workflow_role)
);

-- 2.4 months — monthly financial periods (5.4)
create table public.months (
  id          uuid primary key default gen_random_uuid(),
  year        int not null,
  month       int not null check (month between 1 and 12),
  label       text not null,               -- e.g. 'August 2026'
  is_closed   boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (year, month)
);

-- ----------------------------------------------------------------------------
-- 3. Transactional tables
-- ----------------------------------------------------------------------------

-- 3.1 expenses — department expenses (5.5)
create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  section_id    uuid not null references public.sections(id),
  month_id      uuid not null references public.months(id),
  description   text not null,
  amount        numeric(14,2) not null default 0,
  status        entry_status not null default 'draft',
  prepared_by   uuid references public.users(id),
  prepared_at   timestamptz,
  reviewed_by   uuid references public.users(id),
  reviewed_at   timestamptz,
  approved_by   uuid references public.users(id),
  approved_at   timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 3.2 sales_data — monthly sales entries (5.6) — covers Ikot Sales / agent sales
create table public.sales_data (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid not null references public.sections(id),
  month_id          uuid not null references public.months(id),
  agent_name        text,
  gross_sales       numeric(14,2) not null default 0,
  cash_collected    numeric(14,2) not null default 0,
  gcash_collected   numeric(14,2) not null default 0,
  expenses          numeric(14,2) not null default 0,
  net_sales         numeric(14,2) not null default 0,
  commission_rate   numeric(5,4),
  commission_amount numeric(14,2),
  status            entry_status not null default 'draft',
  prepared_by       uuid references public.users(id),
  prepared_at       timestamptz,
  reviewed_by       uuid references public.users(id),
  reviewed_at       timestamptz,
  approved_by       uuid references public.users(id),
  approved_at       timestamptz,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 3.3 financial_summary — pre-computed monthly totals (5.7)
create table public.financial_summary (
  id                uuid primary key default gen_random_uuid(),
  section_id        uuid references public.sections(id),   -- null = company-wide
  month_id          uuid not null references public.months(id),
  total_sales       numeric(14,2) not null default 0,
  total_expenses    numeric(14,2) not null default 0,
  bottomline        numeric(14,2) not null default 0,
  total_commission  numeric(14,2) not null default 0,
  computed_at       timestamptz not null default now(),
  unique (section_id, month_id)
);

-- 3.4 audit_log — full audit trail (referenced in section 1 overview)
create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references public.users(id),
  entity_table text not null,
  entity_id    uuid not null,
  action       text not null,              -- 'created' | 'submitted' | 'reviewed' | 'approved' | 'rejected' | 'edited'
  from_status  entry_status,
  to_status    entry_status,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index on public.expenses (section_id, month_id, status);
create index on public.sales_data (section_id, month_id, status);
create index on public.audit_log (entity_table, entity_id);

-- ----------------------------------------------------------------------------
-- 4. Helper functions (used by RLS policies)
-- ----------------------------------------------------------------------------

-- Current app-level user row for auth.uid()
create or replace function public.current_app_user()
returns public.users
language sql stable
security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'super_admin'
  );
$$;

-- Does the current user hold this workflow_role in this section?
create or replace function public.has_workflow_role(p_section_id uuid, p_role workflow_role)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid()
      and section_id = p_section_id
      and workflow_role = p_role
  );
$$;

-- Does the current user have ANY workflow role (i.e. belong to) this section?
create or replace function public.in_section(p_section_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_access
    where user_id = auth.uid() and section_id = p_section_id
  ) or exists (
    select 1 from public.users
    where id = auth.uid() and section_id = p_section_id
  );
$$;

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.sections enable row level security;
alter table public.users enable row level security;
alter table public.user_access enable row level security;
alter table public.months enable row level security;
alter table public.expenses enable row level security;
alter table public.sales_data enable row level security;
alter table public.financial_summary enable row level security;
alter table public.audit_log enable row level security;

-- sections: everyone authenticated can read (needed for nav/labels)
create policy sections_select on public.sections
  for select using (auth.role() = 'authenticated');
create policy sections_super_admin_all on public.sections
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- users: can read own row; super admin reads/writes all
create policy users_select_self on public.users
  for select using (id = auth.uid() or public.is_super_admin());
create policy users_super_admin_all on public.users
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- user_access: users can see their own grants; super admin manages all
create policy user_access_select_self on public.user_access
  for select using (user_id = auth.uid() or public.is_super_admin());
create policy user_access_super_admin_all on public.user_access
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- months: readable by any authenticated user; only super admin writes
create policy months_select on public.months
  for select using (auth.role() = 'authenticated');
create policy months_super_admin_all on public.months
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- expenses -------------------------------------------------------------
create policy expenses_super_admin_all on public.expenses
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- Anyone in the section can view entries in their section.
create policy expenses_select_section on public.expenses
  for select using (public.in_section(section_id));

-- Preparers can insert and edit their own draft/prepared entries.
create policy expenses_insert_preparer on public.expenses
  for insert with check (
    public.has_workflow_role(section_id, 'preparer')
    and prepared_by = auth.uid()
  );
create policy expenses_update_preparer on public.expenses
  for update using (
    public.has_workflow_role(section_id, 'preparer')
    and prepared_by = auth.uid()
    and status in ('draft', 'prepared')
  );

-- Reviewers can move 'prepared' -> 'reviewed' entries in their section.
create policy expenses_update_reviewer on public.expenses
  for update using (
    public.has_workflow_role(section_id, 'reviewer')
    and status = 'prepared'
  );

-- Approvers can move 'reviewed' -> 'approved' entries in their section.
create policy expenses_update_approver on public.expenses
  for update using (
    public.has_workflow_role(section_id, 'approver')
    and status = 'reviewed'
  );

-- sales_data -------------------------------------------------------------
create policy sales_super_admin_all on public.sales_data
  for all using (public.is_super_admin()) with check (public.is_super_admin());

create policy sales_select_section on public.sales_data
  for select using (public.in_section(section_id));

create policy sales_insert_preparer on public.sales_data
  for insert with check (
    public.has_workflow_role(section_id, 'preparer')
    and prepared_by = auth.uid()
  );
create policy sales_update_preparer on public.sales_data
  for update using (
    public.has_workflow_role(section_id, 'preparer')
    and prepared_by = auth.uid()
    and status in ('draft', 'prepared')
  );
create policy sales_update_reviewer on public.sales_data
  for update using (
    public.has_workflow_role(section_id, 'reviewer')
    and status = 'prepared'
  );
create policy sales_update_approver on public.sales_data
  for update using (
    public.has_workflow_role(section_id, 'approver')
    and status = 'reviewed'
  );

-- financial_summary: read-only to section members, full access to super admin
create policy summary_select_section on public.financial_summary
  for select using (section_id is null or public.in_section(section_id));
create policy summary_super_admin_all on public.financial_summary
  for all using (public.is_super_admin()) with check (public.is_super_admin());

-- audit_log: append-only from the app; readable within section context,
-- full access to super admin
create policy audit_insert_any_authenticated on public.audit_log
  for insert with check (auth.role() = 'authenticated');
create policy audit_select_super_admin on public.audit_log
  for select using (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 6. Seed: sections + current month
-- ----------------------------------------------------------------------------

insert into public.sections (code, name) values
  ('admin', 'Admin'),
  ('finance', 'Finance'),
  ('logistics', 'Logistics'),
  ('marketing', 'Marketing'),
  ('sales', 'Sales')
on conflict (code) do nothing;

insert into public.months (year, month, label)
values (2026, 9, 'September 2026')
on conflict (year, month) do nothing;

-- Test users (super_admin, preparer, reviewer, approver) and their
-- user_access grants are created by supabase/seed-users.mjs, since
-- auth.users rows (with passwords) must go through the Supabase Auth API,
-- not a raw SQL insert.
