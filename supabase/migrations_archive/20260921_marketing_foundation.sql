-- IBX Marketing foundation: campaigns, channels, leads and marketing activities
create type public.marketing_campaign_status as enum ('draft','prepared','reviewed','approved','active','paused','completed','cancelled');
create type public.marketing_lead_status as enum ('new','qualified','contacted','nurturing','converted','lost');
create type public.marketing_activity_type as enum ('call','email','meeting','social','event','follow_up','other');

create table public.marketing_channels (
  id uuid primary key default gen_random_uuid(),
  channel_code text not null unique,
  channel_name text not null,
  channel_type text not null default 'other',
  active boolean not null default true,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text not null unique,
  campaign_name text not null,
  objective text,
  campaign_type text not null default 'general',
  channel_id uuid references public.marketing_channels(id),
  owner_id uuid references public.users(id),
  start_date date,
  end_date date,
  budget numeric(14,2) not null default 0,
  expected_revenue numeric(14,2) not null default 0,
  actual_spend numeric(14,2) not null default 0,
  actual_revenue numeric(14,2) not null default 0,
  target_leads integer not null default 0,
  generated_leads integer not null default 0,
  converted_leads integer not null default 0,
  status public.marketing_campaign_status not null default 'draft',
  notes text,
  prepared_by uuid references public.users(id), prepared_at timestamptz,
  reviewed_by uuid references public.users(id), reviewed_at timestamptz,
  approved_by uuid references public.users(id), approved_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  lead_code text not null unique,
  campaign_id uuid references public.marketing_campaigns(id),
  channel_id uuid references public.marketing_channels(id),
  company_name text,
  contact_name text not null,
  email text,
  phone text,
  source text,
  estimated_value numeric(14,2) not null default 0,
  status public.marketing_lead_status not null default 'new',
  assigned_to uuid references public.users(id),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.marketing_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.marketing_leads(id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns(id) on delete cascade,
  activity_type public.marketing_activity_type not null default 'other',
  activity_date timestamptz not null default now(),
  subject text not null,
  details text,
  outcome text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create index marketing_campaigns_status_idx on public.marketing_campaigns(status);
create index marketing_leads_status_idx on public.marketing_leads(status);
create index marketing_leads_campaign_idx on public.marketing_leads(campaign_id);
create index marketing_activities_lead_idx on public.marketing_activities(lead_id);

insert into public.marketing_channels(channel_code, channel_name, channel_type)
values ('DIGITAL','Digital Marketing','digital'),('SOCIAL','Social Media','social'),('EVENT','Events','event'),('REFERRAL','Referral','referral')
on conflict (channel_code) do nothing;

alter table public.marketing_channels enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_leads enable row level security;
alter table public.marketing_activities enable row level security;

create policy marketing_channels_access on public.marketing_channels for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
create policy marketing_campaigns_access on public.marketing_campaigns for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
create policy marketing_leads_access on public.marketing_leads for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);
create policy marketing_activities_access on public.marketing_activities for all using (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
) with check (
  exists(select 1 from public.users u where u.id=auth.uid() and (u.role='super_admin' or u.section_id=(select id from public.sections where code='marketing') or exists(select 1 from public.user_access ua join public.sections s on s.id=ua.section_id where ua.user_id=auth.uid() and s.code='marketing')))
);

create or replace function public.marketing_refresh_campaign_metrics(p_campaign_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  update public.marketing_campaigns c set
    generated_leads=(select count(*) from public.marketing_leads l where l.campaign_id=c.id),
    converted_leads=(select count(*) from public.marketing_leads l where l.campaign_id=c.id and l.status='converted'),
    updated_at=now()
  where c.id=p_campaign_id;
end; $$;
grant execute on function public.marketing_refresh_campaign_metrics(uuid) to authenticated;
