-- ============================================================================
-- Build 57 — Role audit mode ("Switch role").
--
-- User request (2026-09-27): a BUSINESS_ADMIN (and the SUPER_ADMIN) must be
-- able to shift into any role inside the app, to audit what that user sees
-- and can do, without separate logins. Option 1 (real switch) chosen: for
-- the duration of the audit the auditor's OWN account genuinely holds the
-- chosen role — app role, home section, business and workflow grants — so
-- the sidebar, page gates, server actions AND database RLS all behave
-- exactly as for a real user with that role. Actions taken while switched
-- are real.
--
-- Safeguards:
--   * Only an account whose REAL role is super_admin or business_admin can
--     start an audit; a business_admin only within its own business; the
--     super_admin must pick a business.
--   * The real state (role, section, business, grants) is saved first and
--     restored by end_role_audit(), which works for the account whatever
--     role it currently holds (it only needs an open audit session).
--   * Sessions expire (default 60 minutes); the app restores an expired
--     session on the next request.
--   * Every start and end is written to audit_log.
--
-- Role presets (user-confirmed mapping, 2026-09-27):
--   BUSINESS_ADMIN            app role business_admin (full access in business)
--   ADMIN_STAFF               admin     + Admin preparer
--   ADMIN_APPROVER            admin     + Admin approver
--   FINANCE_STAFF             finance   + Finance preparer (Procurement is in Finance)
--   FINANCE_APPROVER          finance   + Finance approver
--   LOGISTICS_STAFF / DRIVER  logistics + Logistics preparer
--   LOGISTICS_APPROVER        logistics + Logistics approver
--   SALES_MARKETING_STAFF     sales     + Sales preparer + Marketing preparer
--   SALES_MARKETING_APPROVER  sales     + Sales approver + Marketing approver
-- An APPROVER preset gets the approver grant only — exactly what a real
-- user set up as "approver" gets — so the audit shows today's behaviour
-- (the user wants approvers able to review too; the app does not yet do
-- that on its own: audit finding A). Several presets may be combined: grants
-- are unioned; the app role / home section come from the first preset.
-- ============================================================================

create table if not exists public.role_audit_sessions (
  user_id uuid primary key references public.users(id) on delete cascade,
  original_role public.app_role not null,
  original_section_id uuid,
  original_business_id uuid,
  original_access jsonb not null default '[]'::jsonb,
  audit_roles text[] not null,
  audit_business_id uuid not null references public.businesses(id),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.role_audit_sessions enable row level security;
drop policy if exists role_audit_sessions_own on public.role_audit_sessions;
create policy role_audit_sessions_own on public.role_audit_sessions
  for select using (user_id = auth.uid());
grant select on public.role_audit_sessions to authenticated;
-- no insert/update/delete grant: only the functions below write it

create or replace function public.start_role_audit(p_roles text[], p_business_id uuid default null, p_minutes int default 60)
returns void language plpgsql security definer set search_path = public as $$
declare
  u record;
  v_business uuid;
  v_role public.app_role;
  v_section uuid;
  v_grants jsonb := '[]'::jsonb;
  r text;
  v_known text[] := array['BUSINESS_ADMIN','ADMIN_STAFF','ADMIN_APPROVER','FINANCE_STAFF','FINANCE_APPROVER',
                          'LOGISTICS_STAFF','LOGISTICS_APPROVER','DRIVER','SALES_MARKETING_STAFF','SALES_MARKETING_APPROVER'];
  sec_code text; wf text;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  select * into u from public.users where id = auth.uid() for update;
  if not found or not u.is_active then raise exception 'Authentication required.'; end if;
  if exists (select 1 from public.role_audit_sessions where user_id = u.id) then
    raise exception 'You are already auditing a role. Return to your own role first.';
  end if;
  if u.role not in ('super_admin','business_admin') then
    raise exception 'Only a Super Admin or Business Admin can switch roles for auditing.';
  end if;
  if p_roles is null or array_length(p_roles, 1) is null then raise exception 'Choose at least one role.'; end if;
  foreach r in array p_roles loop
    if not (upper(r) = any(v_known)) then raise exception 'Unknown role: %', r; end if;
  end loop;
  if u.role = 'business_admin' then
    if upper(p_roles[1]) = 'BUSINESS_ADMIN' and array_length(p_roles,1) = 1 then
      raise exception 'You already are a Business Admin.';
    end if;
    v_business := u.business_id;               -- own business only
  else
    v_business := p_business_id;
    if v_business is null then raise exception 'Choose the business to audit.'; end if;
  end if;
  if not exists (select 1 from public.businesses where id = v_business and is_active) then
    raise exception 'Business not found or inactive.';
  end if;

  -- primary role/section from the first preset
  case upper(p_roles[1])
    when 'BUSINESS_ADMIN' then v_role := 'business_admin'; sec_code := null;
    when 'ADMIN_STAFF' then v_role := 'admin'; sec_code := 'admin';
    when 'ADMIN_APPROVER' then v_role := 'admin'; sec_code := 'admin';
    when 'FINANCE_STAFF' then v_role := 'finance'; sec_code := 'finance';
    when 'FINANCE_APPROVER' then v_role := 'finance'; sec_code := 'finance';
    when 'LOGISTICS_STAFF' then v_role := 'logistics'; sec_code := 'logistics';
    when 'DRIVER' then v_role := 'logistics'; sec_code := 'logistics';
    when 'LOGISTICS_APPROVER' then v_role := 'logistics'; sec_code := 'logistics';
    when 'SALES_MARKETING_STAFF' then v_role := 'sales'; sec_code := 'sales';
    when 'SALES_MARKETING_APPROVER' then v_role := 'sales'; sec_code := 'sales';
  end case;
  v_section := (select id from public.sections where code = sec_code);

  -- union of grants from every preset
  foreach r in array p_roles loop
    wf := case when upper(r) like '%APPROVER' then 'approver' else 'preparer' end;
    for sec_code in
      select unnest(case upper(r)
        when 'ADMIN_STAFF' then array['admin'] when 'ADMIN_APPROVER' then array['admin']
        when 'FINANCE_STAFF' then array['finance'] when 'FINANCE_APPROVER' then array['finance']
        when 'LOGISTICS_STAFF' then array['logistics'] when 'DRIVER' then array['logistics'] when 'LOGISTICS_APPROVER' then array['logistics']
        when 'SALES_MARKETING_STAFF' then array['sales','marketing'] when 'SALES_MARKETING_APPROVER' then array['sales','marketing']
        else array[]::text[] end)
    loop
      v_grants := v_grants || jsonb_build_array(jsonb_build_object('section_id', (select id from public.sections where code = sec_code), 'workflow_role', wf));
    end loop;
  end loop;

  insert into public.role_audit_sessions(user_id, original_role, original_section_id, original_business_id, original_access, audit_roles, audit_business_id, expires_at)
  values (u.id, u.role, u.section_id, u.business_id,
          coalesce((select jsonb_agg(jsonb_build_object('section_id', a.section_id, 'workflow_role', a.workflow_role)) from public.user_access a where a.user_id = u.id), '[]'::jsonb),
          (select array_agg(upper(x)) from unnest(p_roles) x), v_business,
          now() + make_interval(mins => greatest(5, least(coalesce(p_minutes, 60), 240))));

  update public.users set role = v_role, section_id = v_section, business_id = v_business where id = u.id;
  delete from public.user_access where user_id = u.id;
  insert into public.user_access(user_id, section_id, workflow_role)
  select distinct u.id, (g->>'section_id')::uuid, (g->>'workflow_role')::public.workflow_role
    from jsonb_array_elements(v_grants) g
   where g->>'section_id' is not null;

  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (u.id, 'users', u.id, 'role_audit_started',
          jsonb_build_object('roles', p_roles, 'business_id', v_business, 'original_role', u.role, 'minutes', coalesce(p_minutes, 60)));
end;
$$;

create or replace function public.end_role_audit()
returns void language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if auth.uid() is null then return; end if;
  select * into s from public.role_audit_sessions where user_id = auth.uid() for update;
  if not found then return; end if;
  update public.users set role = s.original_role, section_id = s.original_section_id, business_id = s.original_business_id where id = s.user_id;
  delete from public.user_access where user_id = s.user_id;
  insert into public.user_access(user_id, section_id, workflow_role)
  select s.user_id, (g->>'section_id')::uuid, (g->>'workflow_role')::public.workflow_role
    from jsonb_array_elements(s.original_access) g;
  delete from public.role_audit_sessions where user_id = s.user_id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (s.user_id, 'users', s.user_id, 'role_audit_ended',
          jsonb_build_object('roles', s.audit_roles, 'business_id', s.audit_business_id, 'restored_role', s.original_role,
                             'expired', s.expires_at <= now()));
end;
$$;

-- Restore every expired session (for a scheduled clean-up or manual run;
-- the app also restores an auditor's own expired session on their next
-- request).
create or replace function public.expire_role_audits()
returns int language plpgsql security definer set search_path = public as $$
declare s record; n int := 0;
begin
  for s in select * from public.role_audit_sessions where expires_at <= now() for update loop
    update public.users set role = s.original_role, section_id = s.original_section_id, business_id = s.original_business_id where id = s.user_id;
    delete from public.user_access where user_id = s.user_id;
    insert into public.user_access(user_id, section_id, workflow_role)
    select s.user_id, (g->>'section_id')::uuid, (g->>'workflow_role')::public.workflow_role from jsonb_array_elements(s.original_access) g;
    delete from public.role_audit_sessions where user_id = s.user_id;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (s.user_id, 'users', s.user_id, 'role_audit_ended', jsonb_build_object('roles', s.audit_roles, 'expired', true));
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.start_role_audit(text[], uuid, int) from public;
revoke all on function public.end_role_audit() from public;
revoke all on function public.expire_role_audits() from public;
grant execute on function public.start_role_audit(text[], uuid, int) to authenticated;
grant execute on function public.end_role_audit() to authenticated;
grant execute on function public.expire_role_audits() to service_role;
