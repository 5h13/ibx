-- IBX Admin Employee Documents & Compliance
create type public.employee_document_status as enum ('pending','verified','rejected','expired','archived');

create table if not exists public.employee_document_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  required_for_active_employee boolean not null default false,
  requires_expiry boolean not null default false,
  default_validity_days int,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete restrict,
  document_type_id uuid not null references public.employee_document_types(id) on delete restrict,
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
  constraint employee_document_dates check (expiry_date is null or issued_date is null or expiry_date >= issued_date)
);

create index if not exists employee_documents_employee_idx on public.employee_documents(employee_id, expiry_date);
create index if not exists employee_documents_status_expiry_idx on public.employee_documents(status, expiry_date);
create index if not exists employee_documents_type_idx on public.employee_documents(document_type_id);

create or replace function public.set_employee_document_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists employee_document_types_set_updated_at on public.employee_document_types;
create trigger employee_document_types_set_updated_at before update on public.employee_document_types for each row execute function public.set_employee_document_updated_at();
drop trigger if exists employee_documents_set_updated_at on public.employee_documents;
create trigger employee_documents_set_updated_at before update on public.employee_documents for each row execute function public.set_employee_document_updated_at();

alter table public.employee_document_types enable row level security;
alter table public.employee_documents enable row level security;

create policy employee_document_types_admin_all on public.employee_document_types for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));
create policy employee_documents_admin_all on public.employee_documents for all using (public.is_super_admin() or public.in_section((select id from public.sections where code='admin'))) with check (public.is_super_admin() or public.in_section((select id from public.sections where code='admin')));

insert into public.employee_document_types(code,name,description,required_for_active_employee,requires_expiry,default_validity_days) values
 ('employment_contract','Employment Contract','Signed employment or engagement agreement.',true,false,null),
 ('government_id','Government ID','Government-issued identification document.',true,true,null),
 ('tax_registration','Tax Registration','Tax registration or taxpayer identification record.',false,false,null),
 ('social_security','Social Security','SSS or equivalent social security record.',false,false,null),
 ('health_membership','Health Membership','PhilHealth or equivalent health membership record.',false,false,null),
 ('housing_membership','Housing Membership','Pag-IBIG or equivalent housing fund record.',false,false,null),
 ('medical_clearance','Medical Clearance','Employment medical clearance or fitness certificate.',true,true,365),
 ('police_clearance','Police/NBI Clearance','Background or clearance document.',false,true,365),
 ('training_certificate','Training / Certification','Training, license, or professional certification.',false,true,null),
 ('drivers_license','Driver License','Driver license for employees assigned to driving duties.',false,true,null)
on conflict(code) do nothing;

-- Private bucket. Application server actions use the Supabase service role for controlled access.
insert into storage.buckets (id,name,public) values ('employee-documents','employee-documents',false) on conflict (id) do update set public=false;
