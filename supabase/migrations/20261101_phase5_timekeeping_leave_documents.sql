-- ============================================================================
-- Phase 5 (Build 49) -- Timekeeping, Leave, Documents & Compliance:
-- U007, U018, U020, U021, U022, U023. (U024 already done in Build 48.)
--
-- Only U023 (Business Document & Compliance) needs new schema -- confirmed by
-- audit that NO business-level (as opposed to employee-level) document/
-- compliance tracking exists anywhere: `businesses` has only
-- id/code/legal_name/trade_name/is_active/branding, and every existing
-- "document" feature (`employee_documents`) is employee-scoped only.
-- U018/U020/U007/U021/U022 are all app-layer/UI work over existing schema;
-- no migration needed for those.
--
-- business_document_types / business_documents mirror
-- employee_document_types / employee_documents exactly in shape, but
-- business_documents is business-scoped (one row per business per document)
-- rather than employee-scoped, using the same restrictive-business-isolation
-- RLS pattern every business-scoped table has used since A001
-- (as restrictive for all using (is_super_admin() or business_id =
-- current_business_id())), layered on top of a permissive admin-tier
-- base policy, same two-layer shape as employee_documents.
-- ============================================================================

create table if not exists public.business_document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  required boolean not null default false,
  requires_expiry boolean not null default false,
  default_validity_days int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  document_type_id uuid not null references public.business_document_types(id) on delete restrict,
  document_name text not null,
  document_number text,
  issued_date date,
  expiry_date date,
  status public.employee_document_status not null default 'pending',
  storage_path text,
  original_file_name text,
  mime_type text,
  file_size bigint,
  notes text,
  uploaded_by uuid not null references public.users(id),
  verified_by uuid references public.users(id),
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_document_dates check (expiry_date is null or issued_date is null or expiry_date >= issued_date)
);

create index if not exists idx_business_documents_business on public.business_documents(business_id, expiry_date);
create index if not exists idx_business_documents_type on public.business_documents(document_type_id);

create or replace function public.set_business_document_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

drop trigger if exists business_document_types_set_updated_at on public.business_document_types;
create trigger business_document_types_set_updated_at before update on public.business_document_types for each row execute function public.set_business_document_updated_at();
drop trigger if exists business_documents_set_updated_at on public.business_documents;
create trigger business_documents_set_updated_at before update on public.business_documents for each row execute function public.set_business_document_updated_at();

alter table public.business_document_types enable row level security;
alter table public.business_documents enable row level security;

-- business_document_types: global master, same shape as employee_document_types.
drop policy if exists business_document_types_admin_all on public.business_document_types;
create policy business_document_types_admin_all on public.business_document_types
  for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- business_documents: permissive admin-tier base policy...
drop policy if exists business_documents_admin_all on public.business_documents;
create policy business_documents_admin_all on public.business_documents
  for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')))
  with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

-- ...layered under the restrictive business-isolation policy every
-- business-scoped table has carried since A001 (both must pass).
drop policy if exists business_documents_business_isolation on public.business_documents;
create policy business_documents_business_isolation on public.business_documents
  as restrictive for all
  using (public.is_super_admin() or business_id = public.current_business_id())
  with check (public.is_super_admin() or business_id = public.current_business_id());

insert into public.business_document_types(code,name,description,required,requires_expiry,default_validity_days) values
 ('business_registration','Business Registration','DTI/SEC/BIR registration or equivalent.',true,false,null),
 ('mayors_permit','Mayor''s Permit','Local government business/mayor''s permit.',true,true,365),
 ('bir_permit','BIR Permit to Operate','Bureau of Internal Revenue permit/registration.',true,false,null),
 ('fire_safety_certificate','Fire Safety Inspection Certificate','Annual fire safety inspection certificate.',false,true,365),
 ('business_insurance','Business Insurance Policy','General liability / property insurance policy.',false,true,365),
 ('environmental_permit','Environmental Compliance Certificate','Environmental compliance certificate, where applicable.',false,true,365)
on conflict(code) do nothing;

-- Private bucket, same pattern as employee-documents; application server
-- actions use the service role for controlled access.
insert into storage.buckets (id,name,public) values ('business-documents','business-documents',false) on conflict (id) do update set public=false;
