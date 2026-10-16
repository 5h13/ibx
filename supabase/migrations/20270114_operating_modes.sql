-- Build 113 — MODE-01 part 1: operating modes per store (document approval points).
--
-- Decided with the owner 2026-10-16:
--   * The SUPER_ADMIN sets each store's mode; a Business Admin cannot change it.
--   * Modes: Full multi-department, Skeletal manning, Single-operator, Custom. One engine: the
--     first three are saved templates; Custom is the same settings edited by the Super Admin.
--   * A mode only changes how each approval point is approved. Every step still runs and
--     creates its document; audit trail, document numbers, stock movements, business
--     isolation and AR / AP are never switched off.
--   * Each document keeps the rules it started under (snapshot at creation).
--   * Auto-approvals are recorded with the mode that allowed them.
--
-- Settings per approval point:
--   two_step  prepare → review → approve, each by a different role, the approver not the preparer (today's flow)
--   one_step  prepare → approve: an approver's "Review" also approves (still a second person)
--   auto      prepare → approved by the system at once, recorded as auto-approved under the mode
--
-- Part 1 covers the documents that share the prepare / review / approve columns:
--   quote (sales_quotations), sales_order (sales_orders), pr (purchase_requisitions),
--   po (purchase_orders), supplier_payment (finance_supplier_payments),
--   receiving (logistics_receipts), expense (expenses).
-- The Storefront points (DR release, returns, price / discount exceptions with warnings)
-- follow in part 2; their keys are stored now so the settings screen is complete.

-- ------------------------------------------------------------------ settings --
create table if not exists public.business_operating_modes (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  mode text not null default 'full' check (mode in ('full', 'skeletal', 'single', 'custom')),
  points jsonb not null default '{}'::jsonb,
  updated_by uuid references public.users(id),
  updated_at timestamptz not null default now()
);
alter table public.business_operating_modes enable row level security;
drop policy if exists business_operating_modes_read on public.business_operating_modes;
create policy business_operating_modes_read on public.business_operating_modes for select to authenticated
  using (public.is_super_admin() or business_id = public.current_business_id());
-- writes only through workflow_set_mode() (Super Admin)
revoke insert, update, delete on public.business_operating_modes from authenticated, anon;
grant select on public.business_operating_modes to authenticated;

create or replace function public.workflow_points()
returns text[] language sql immutable as $$
  select array['quote','sales_order','pr','po','supplier_payment','receiving','expense',
               'dr_release','returns','price_exception']
$$;

-- the three templates
create or replace function public.workflow_template(p_mode text)
returns jsonb language sql immutable as $$
  select jsonb_object_agg(p, case p_mode when 'single' then 'auto' when 'skeletal' then 'one_step' else 'two_step' end)
    from unnest(public.workflow_points()) p
$$;

-- current setting of one point for a business (no row = Full)
create or replace function public.workflow_point_setting(p_business uuid, p_point text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(m.points ->> p_point,
                                   public.workflow_template(case when m.mode = 'custom' then 'full' else m.mode end) ->> p_point)
                     from public.business_operating_modes m where m.business_id = p_business), 'two_step')
$$;

create or replace function public.workflow_mode_label(p_mode text)
returns text language sql immutable as $$
  select case p_mode when 'full' then 'Full multi-department' when 'skeletal' then 'Skeletal manning'
                     when 'single' then 'Single-operator' when 'custom' then 'Custom' else p_mode end
$$;

-- Super Admin: set a store's mode. Template modes take the template; custom keeps the given points.
create or replace function public.workflow_set_mode(p_business uuid, p_mode text, p_points jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_points jsonb; k text; v text; v_old record;
begin
  if not public.is_super_admin() then raise exception 'Only the Super Admin can change a store''s operating mode.'; end if;
  if not exists (select 1 from public.businesses where id = p_business) then raise exception 'Store not found.'; end if;
  if p_mode not in ('full', 'skeletal', 'single', 'custom') then raise exception 'Unknown operating mode %.', p_mode; end if;
  if p_mode = 'custom' then
    v_points := '{}'::jsonb;
    foreach k in array public.workflow_points() loop
      v := coalesce(p_points ->> k, 'two_step');
      if v not in ('two_step', 'one_step', 'auto') then raise exception 'Unknown setting % for %.', v, k; end if;
      v_points := v_points || jsonb_build_object(k, v);
    end loop;
  else
    v_points := public.workflow_template(p_mode);
  end if;
  select * into v_old from public.business_operating_modes where business_id = p_business;
  insert into public.business_operating_modes(business_id, mode, points, updated_by, updated_at)
  values (p_business, p_mode, v_points, auth.uid(), now())
  on conflict (business_id) do update set mode = excluded.mode, points = excluded.points, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'business_operating_modes', p_business, 'operating_mode_changed',
          jsonb_build_object('from_mode', coalesce(v_old.mode, 'full'), 'to_mode', p_mode, 'from_points', v_old.points, 'to_points', v_points));
  return jsonb_build_object('mode', p_mode, 'points', v_points);
end $$;

-- every store's mode (Super Admin screen); others see their own store only
create or replace function public.workflow_modes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'business_id', b.id, 'code', b.code, 'name', coalesce(b.trade_name, b.code),
           'mode', coalesce(m.mode, 'full'),
           'points', coalesce(m.points, public.workflow_template('full')),
           'updated_at', m.updated_at,
           'updated_by', (select full_name from public.users u where u.id = m.updated_by)) order by b.code), '[]'::jsonb)
    from public.businesses b left join public.business_operating_modes m on m.business_id = b.id
   where b.is_active and (public.is_super_admin() or b.id = public.current_business_id())
$$;

-- --------------------------------------------------- document rule snapshot --
-- The setting a document started under. Written when the document is created.
create table if not exists public.workflow_document_rules (
  entity_table text not null,
  entity_id uuid not null,
  business_id uuid not null,
  point text not null,
  setting text not null check (setting in ('two_step', 'one_step', 'auto')),
  mode text not null,
  created_at timestamptz not null default now(),
  primary key (entity_table, entity_id)
);
alter table public.workflow_document_rules enable row level security;
drop policy if exists workflow_document_rules_read on public.workflow_document_rules;
create policy workflow_document_rules_read on public.workflow_document_rules for select to authenticated
  using (public.is_super_admin() or business_id = public.current_business_id());
revoke insert, update, delete on public.workflow_document_rules from authenticated, anon;
grant select on public.workflow_document_rules to authenticated;

create or replace function public.workflow_point_of(p_table text)
returns text language sql immutable as $$
  select case p_table when 'sales_quotations' then 'quote' when 'sales_orders' then 'sales_order'
    when 'purchase_requisitions' then 'pr' when 'purchase_orders' then 'po'
    when 'finance_supplier_payments' then 'supplier_payment' when 'logistics_receipts' then 'receiving'
    when 'expenses' then 'expense' end
$$;

-- may the current user give the final approval on this document? (same rules the screens use)
create or replace function public.workflow_can_approve(p_table text, p_section uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin() or case p_table
    when 'sales_quotations' then public.has_workflow_role((select id from public.sections where code = 'sales'), 'approver')
    when 'sales_orders' then public.can_approve_storefront()
    when 'logistics_receipts' then public.has_workflow_role((select id from public.sections where code = 'logistics'), 'approver')
    when 'expenses' then public.has_workflow_role(p_section, 'approver')
    else public.has_workflow_role((select id from public.sections where code = 'finance'), 'approver') end
$$;

-- ----------------------------------------------------------- the advance step --
-- AFTER INSERT / UPDATE OF status on each document table.
--   * on insert: store the rule snapshot;
--   * reaching "prepared" under auto: the system reviews and approves at once (stamped with the
--     preparer, recorded as auto-approved under the mode);
--   * reaching "reviewed" under one_step by a user who may approve (and is not the preparer):
--     the system completes the approval in the same action, stamped with that user.
-- Runs as the function owner, so the API-session checks (RA-06) do not apply to these two
-- internal updates; guard_sales_order skips its approver check while ibx.workflow_auto is set.
create or replace function public.workflow_mode_advance()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_point text := public.workflow_point_of(tg_table_name);
  v_setting text; v_mode text; v_prep uuid; v_actor uuid := auth.uid(); n jsonb := to_jsonb(new);
  v_section uuid := case when tg_table_name = 'expenses' then nullif(n->>'section_id', '')::uuid end;
begin
  if coalesce(current_setting('ibx.workflow_auto', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    select coalesce(m.mode, 'full') into v_mode from public.businesses b left join public.business_operating_modes m on m.business_id = b.id where b.id = new.business_id;
    insert into public.workflow_document_rules(entity_table, entity_id, business_id, point, setting, mode)
    values (tg_table_name, new.id, new.business_id, v_point, public.workflow_point_setting(new.business_id, v_point), coalesce(v_mode, 'full'))
    on conflict do nothing;
  elsif new.status::text is not distinct from old.status::text then
    return null;
  end if;
  if new.status::text not in ('prepared', 'reviewed') then return null; end if;

  select setting, mode into v_setting, v_mode from public.workflow_document_rules where entity_table = tg_table_name and entity_id = new.id;
  if v_setting is null then  -- documents created before Build 113 follow the store's current setting
    v_setting := public.workflow_point_setting(new.business_id, v_point);
    select coalesce(m.mode, 'full') into v_mode from public.businesses b left join public.business_operating_modes m on m.business_id = b.id where b.id = new.business_id;
  end if;
  v_prep := coalesce(nullif(n->>'prepared_by', '')::uuid, nullif(n->>'created_by', '')::uuid);

  if new.status::text = 'prepared' and v_setting = 'auto' then
    perform set_config('ibx.workflow_auto', 'on', true);
    execute format('update public.%I set status = %L, reviewed_by = $1, reviewed_at = now() where id = $2', tg_table_name, 'reviewed') using v_prep, new.id;
    execute format('update public.%I set status = %L, approved_by = $1, approved_at = now() where id = $2', tg_table_name, 'approved') using v_prep, new.id;
    perform set_config('ibx.workflow_auto', '', true);
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (coalesce(v_actor, v_prep), tg_table_name, new.id, 'auto_approved',
            jsonb_build_object('point', v_point, 'mode', v_mode, 'mode_label', public.workflow_mode_label(v_mode),
                               'note', 'auto-approved under ' || public.workflow_mode_label(v_mode) || ' mode'));
  elsif new.status::text = 'reviewed' and tg_op = 'UPDATE' and v_setting = 'one_step'
        and v_actor is not null and v_actor is distinct from v_prep
        and public.workflow_can_approve(tg_table_name, v_section) then
    perform set_config('ibx.workflow_auto', 'on', true);
    execute format('update public.%I set status = %L, approved_by = $1, approved_at = now() where id = $2', tg_table_name, 'approved') using v_actor, new.id;
    perform set_config('ibx.workflow_auto', '', true);
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (v_actor, tg_table_name, new.id, 'one_step_approved',
            jsonb_build_object('point', v_point, 'mode', v_mode, 'mode_label', public.workflow_mode_label(v_mode),
                               'note', 'reviewed and approved in one step under ' || public.workflow_mode_label(v_mode) || ' mode'));
  end if;
  return null;
exception when others then
  perform set_config('ibx.workflow_auto', '', true);
  raise;
end $$;
revoke all on function public.workflow_mode_advance() from public, authenticated;

do $$
declare t text;
begin
  foreach t in array array['sales_quotations','sales_orders','purchase_requisitions','purchase_orders',
                           'finance_supplier_payments','logistics_receipts','expenses'] loop
    execute format('drop trigger if exists zz_workflow_mode_advance on public.%I', t);
    execute format('create trigger zz_workflow_mode_advance after insert or update of status on public.%I for each row execute function public.workflow_mode_advance()', t);
  end loop;
end $$;

-- guard_sales_order: the Sales-approver check does not apply to the system's own auto step
create or replace function public.guard_sales_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if tg_op = 'INSERT' then
    select code into v_code from public.businesses where id = new.business_id;
    new.order_number := public.storefront_next_number(coalesce(v_code, 'IBX') || '-SO', 'sales_orders', 'order_number');
  else
    if new.order_number is distinct from old.order_number then raise exception 'Sales order numbers are system-generated and cannot be changed.'; end if;
    if new.status = 'approved' and old.status is distinct from 'approved' and auth.uid() is not null and not public.can_approve_storefront()
       and coalesce(current_setting('ibx.workflow_auto', true), '') <> 'on' then
      raise exception 'Only the Sales final approver (Sales approver), a Business Admin or the Super Admin can approve a sales order.';
    end if;
  end if;
  return new;
end $$;

-- the rules a document is under, for its screen ("Approval: auto under Single-operator mode")
create or replace function public.workflow_rules_for(p_table text, p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(r.entity_id, jsonb_build_object('setting', r.setting, 'mode', r.mode, 'mode_label', public.workflow_mode_label(r.mode))), '{}'::jsonb)
    from public.workflow_document_rules r
   where r.entity_table = p_table and r.entity_id = any(p_ids)
     and (public.is_super_admin() or r.business_id = public.current_business_id())
$$;

-- recent auto / one-step approvals for the Business Admin dashboard
create or replace function public.workflow_recent_auto_approvals(p_days int default 7)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'at' desc), '[]'::jsonb) from (
    select jsonb_build_object('at', a.created_at, 'action', a.action, 'table', a.entity_table, 'id', a.entity_id,
                              'point', a.detail->>'point', 'mode_label', a.detail->>'mode_label',
                              'number', case a.entity_table
                                when 'sales_quotations' then (select quotation_number from public.sales_quotations where id = a.entity_id)
                                when 'sales_orders' then (select order_number from public.sales_orders where id = a.entity_id)
                                when 'purchase_requisitions' then (select pr_number from public.purchase_requisitions where id = a.entity_id)
                                when 'purchase_orders' then (select po_number from public.purchase_orders where id = a.entity_id)
                                when 'logistics_receipts' then (select receipt_number from public.logistics_receipts where id = a.entity_id)
                                when 'expenses' then (select left(description, 60) from public.expenses where id = a.entity_id)
                                when 'finance_supplier_payments' then (select payment_number from public.finance_supplier_payments where id = a.entity_id)
                                else null end,
                              'by', (select full_name from public.users u where u.id = a.actor_id)) as x
      from public.audit_log a join public.workflow_document_rules r on r.entity_table = a.entity_table and r.entity_id = a.entity_id
     where a.action in ('auto_approved', 'one_step_approved') and a.created_at > now() - make_interval(days => greatest(p_days, 1))
       and ((public.is_super_admin() and (public.pricing_business_id() is null or r.business_id = public.pricing_business_id()))
            or (public.is_business_admin() and r.business_id = public.current_business_id()))
     limit 200) s
$$;

grant execute on function public.workflow_points(), public.workflow_template(text), public.workflow_point_setting(uuid, text),
  public.workflow_mode_label(text), public.workflow_set_mode(uuid, text, jsonb), public.workflow_modes(),
  public.workflow_rules_for(text, uuid[]), public.workflow_recent_auto_approvals(int) to authenticated;
