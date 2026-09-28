-- Admin Policies & Announcements
create table if not exists public.admin_policy_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_policies (
  id uuid primary key default gen_random_uuid(),
  policy_no text not null unique,
  title text not null,
  category_id uuid references public.admin_policy_categories(id),
  version text not null default '1.0',
  effective_date date,
  review_date date,
  owner_department text,
  summary text,
  content text not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  acknowledgement_required boolean not null default false,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  announcement_no text not null unique,
  title text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  audience text not null default 'all' check (audience in ('all','admin','finance','logistics','marketing','sales')),
  summary text,
  content text not null,
  publish_from timestamptz,
  publish_until timestamptz,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  published_by uuid references auth.users(id),
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.admin_policies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  unique(policy_id,user_id)
);

create index if not exists admin_policies_status_idx on public.admin_policies(status);
create index if not exists admin_policies_effective_idx on public.admin_policies(effective_date);
create index if not exists admin_announcements_status_idx on public.admin_announcements(status);
create index if not exists admin_announcements_publish_idx on public.admin_announcements(publish_from,publish_until);
create index if not exists admin_policy_ack_user_idx on public.admin_policy_acknowledgements(user_id);

insert into public.admin_policy_categories(code,name,description)
values
 ('hr','HR & People','Employment, conduct, leave and workplace policies'),
 ('finance','Finance & Controls','Financial control and administrative finance policies'),
 ('it','IT & Security','Technology, access and information security policies'),
 ('operations','Operations','Operational procedures and office rules'),
 ('safety','Safety & Compliance','Safety, compliance and emergency policies'),
 ('other','Other','Other internal policies')
on conflict (code) do nothing;

alter table public.admin_policy_categories enable row level security;
alter table public.admin_policies enable row level security;
alter table public.admin_announcements enable row level security;
alter table public.admin_policy_acknowledgements enable row level security;

drop policy if exists admin_policy_categories_select on public.admin_policy_categories;
drop policy if exists admin_policies_select on public.admin_policies;
drop policy if exists admin_announcements_select on public.admin_announcements;
drop policy if exists admin_policy_ack_select on public.admin_policy_acknowledgements;
drop policy if exists admin_policy_ack_insert on public.admin_policy_acknowledgements;

create policy admin_policy_categories_select on public.admin_policy_categories for select to authenticated using (true);
create policy admin_policies_select on public.admin_policies for select to authenticated using (status = 'published' or created_by = auth.uid());
create policy admin_announcements_select on public.admin_announcements for select to authenticated using (
  status = 'published' and (publish_from is null or publish_from <= now()) and (publish_until is null or publish_until >= now())
  or created_by = auth.uid()
);
create policy admin_policy_ack_select on public.admin_policy_acknowledgements for select to authenticated using (user_id = auth.uid());
create policy admin_policy_ack_insert on public.admin_policy_acknowledgements for insert to authenticated with check (user_id = auth.uid());

-- Application actions use the existing service-role/admin client and audit_log.
