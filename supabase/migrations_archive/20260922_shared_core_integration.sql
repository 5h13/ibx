-- IBX Shared Core / Cross-Module Integration Foundation
-- Cumulative on top of the Approvals / Decision Engine build.

create table if not exists public.workflow_registry (
  id uuid primary key default gen_random_uuid(),
  module_code text not null,
  module_name text not null,
  section_code text not null,
  workflow_name text not null,
  states text[] not null,
  posting_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(module_code, workflow_name)
);

create index if not exists idx_workflow_registry_section on public.workflow_registry(section_code, active);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  source_module text not null,
  target_module text not null,
  event_type text not null,
  source_table text,
  source_record_id uuid,
  status text not null default 'completed' check (status in ('pending','completed','failed','skipped')),
  message text,
  payload jsonb,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_integration_events_created on public.integration_events(created_at desc);
create index if not exists idx_integration_events_status on public.integration_events(status, created_at desc);
create index if not exists idx_integration_events_source on public.integration_events(source_module, target_module, created_at desc);

alter table public.workflow_registry enable row level security;
alter table public.integration_events enable row level security;

-- Workflow metadata is readable to authenticated users; writes are service-role only.
drop policy if exists workflow_registry_read on public.workflow_registry;
create policy workflow_registry_read on public.workflow_registry
  for select using (auth.role() = 'authenticated');

-- Integration events are intentionally visible only to super admins.
drop policy if exists integration_events_read on public.integration_events;
create policy integration_events_read on public.integration_events
  for select using (public.is_super_admin());

-- Server-side integration logger. Source modules remain authoritative; this is the
-- cross-module trace, not a replacement for their own transaction/audit records.
create or replace function public.record_integration_event(
  p_source_module text,
  p_target_module text,
  p_event_type text,
  p_source_table text default null,
  p_source_record_id uuid default null,
  p_status text default 'completed',
  p_message text default null,
  p_payload jsonb default null,
  p_actor_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.integration_events(
    source_module,target_module,event_type,source_table,source_record_id,
    status,message,payload,actor_id,completed_at
  ) values (
    p_source_module,p_target_module,p_event_type,p_source_table,p_source_record_id,
    p_status,p_message,p_payload,p_actor_id,
    case when p_status in ('completed','skipped') then now() else null end
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.record_integration_event(text,text,text,text,uuid,text,text,jsonb,uuid) to authenticated;

-- Registry of the operational workflows built so far.
insert into public.workflow_registry(module_code,module_name,section_code,workflow_name,states,posting_enabled)
values
 ('admin-expenses','Admin Expenses','admin','Expense approval',array['draft','prepared','reviewed','approved'],true),
 ('admin-requests','Internal Requests','admin','Request approval',array['draft','prepared','reviewed','approved','rejected','cancelled','fulfilled'],true),
 ('procurement','Procurement','finance','PR / PO approval',array['draft','prepared','reviewed','approved'],false),
 ('accounts-payable','Accounts Payable','finance','Supplier invoice approval',array['draft','prepared','reviewed','approved','partially_paid','paid','voided'],false),
 ('accounts-payable','Accounts Payable','finance','Supplier payment',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('accounts-receivable','Accounts Receivable','finance','Customer invoice approval',array['draft','prepared','reviewed','approved'],false),
 ('accounts-receivable','Accounts Receivable','finance','Customer receipt',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('bank-cash','Bank / Cash','finance','Cash transaction',array['draft','prepared','reviewed','approved','posted','voided'],true),
 ('budgeting','Budgets & Forecasting','finance','Budget approval',array['draft','prepared','reviewed','approved','closed'],false),
 ('accounting','Accounting','finance','Journal entry',array['draft','prepared','reviewed','approved','posted'],true),
 ('payroll','Payroll','finance','Payroll run',array['draft','prepared','reviewed','approved','posted'],true),
 ('inventory','Inventory','logistics','Goods receiving',array['draft','prepared','reviewed','approved','posted'],true),
 ('inventory','Inventory','logistics','Stock transfer',array['draft','prepared','reviewed','approved','posted'],true),
 ('delivery','Delivery','logistics','Delivery order',array['draft','prepared','picked','packed','reviewed','approved','dispatched','delivered'],false),
 ('marketing','Marketing','marketing','Campaign approval',array['draft','prepared','reviewed','approved','active','paused','completed'],false),
 ('sales','Sales','sales','Sales order approval',array['draft','prepared','reviewed','approved'],false),
 ('sales','Sales','sales','Revenue recognition',array['draft','prepared','reviewed','approved','posted'],true),
 ('sales','Sales','sales','Commission',array['draft','prepared','reviewed','approved','paid'],false),
 ('sales','Sales','sales','Commission payout',array['draft','prepared','reviewed','approved','paid'],false)
on conflict(module_code,workflow_name) do update set
  module_name=excluded.module_name,
  section_code=excluded.section_code,
  states=excluded.states,
  posting_enabled=excluded.posting_enabled,
  updated_at=now();
