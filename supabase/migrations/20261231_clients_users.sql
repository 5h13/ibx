-- Build 96 — Clients list (Sales / Finance) with agent moves by the Sales approver or the Business Admin
-- (both agents notified), agent-app notices, and deleting a login that has no records.

-- ------------------------------------------------------------------ who may move a client to another agent
create or replace function public.can_reassign_agent(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null   -- data loaders run in the SQL editor
      or public.is_super_admin()
      or (p_business = public.current_business_id() and (public.is_business_admin()
          or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                      where ua.user_id = auth.uid() and s.code = 'sales' and ua.workflow_role = 'approver')));
$$;
revoke all on function public.can_reassign_agent(uuid) from public;
grant execute on function public.can_reassign_agent(uuid) to authenticated;

create or replace function public.customer_agent_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.agent_id is null then new.agent_id := public.sales_agent_store(new.business_id); return new; end if;
  if tg_op = 'UPDATE' and new.agent_id is not distinct from old.agent_id then return new; end if;
  select * into a from public.sales_agents where id = new.agent_id;
  if not found then raise exception 'Agent not found.'; end if;
  if not a.active then raise exception 'Agent % is inactive.', a.name; end if;
  if a.kind = 'store' and a.business_id is distinct from new.business_id then raise exception 'That is another store''s own agent.'; end if;
  if tg_op = 'UPDATE' and not public.can_reassign_agent(new.business_id) then
    raise exception 'Only the Sales approver or the Business Admin can move a client to another agent.';
  end if;
  return new;
end $$;

-- both agents hear about it (in the agent app), and the move is in the audit log
create or replace function public.customer_agent_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare o record; n record; who text; note text := nullif(btrim(current_setting('ibx.reassign_note', true)), ''); v_msg text;
begin
  select id, name, user_id into o from public.sales_agents where id = old.agent_id;
  select id, name, user_id into n from public.sales_agents where id = new.agent_id;
  select coalesce(nullif(btrim(full_name), ''), email) into who from public.users where id = auth.uid();
  v_msg := coalesce(who, 'The store') || ' moved ' || new.legal_name || ' (' || new.customer_code || ') from ' || coalesce(o.name, '—') || ' to ' || coalesce(n.name, '—') || '.'
           || coalesce(' Note: ' || note, '');
  if o.user_id is not null then
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    values (new.business_id, o.user_id, 'sales', 'finance_customers', new.id, 'Client moved to another agent: ' || new.legal_name, v_msg, '/agent', auth.uid());
  end if;
  if n.user_id is not null then
    insert into public.app_notifications(business_id, recipient_user_id, section_code, entity_table, entity_id, title, message, action_url, created_by)
    values (new.business_id, n.user_id, 'sales', 'finance_customers', new.id, 'New client for you: ' || new.legal_name, v_msg, '/agent', auth.uid());
  end if;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'finance_customers', new.id, 'customer_agent_moved', jsonb_build_object('from', o.name, 'to', n.name, 'note', note));
  return null;
end $$;
revoke all on function public.customer_agent_notify() from public, authenticated;
drop trigger if exists finance_customers_agent_notify on public.finance_customers;
create trigger finance_customers_agent_notify after update of agent_id on public.finance_customers
  for each row when (old.agent_id is distinct from new.agent_id) execute function public.customer_agent_notify();

-- ------------------------------------------------------------------ Clients list
create or replace function public.clients_access() returns boolean language sql stable security definer set search_path = public as $$
  select public.is_super_admin() or public.is_business_admin() or public.has_section_access('sales') or public.has_section_access('finance');
$$;
revoke all on function public.clients_access() from public;

create or replace function public.sales_clients_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b uuid := public.current_business_id(); today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.clients_access() then raise exception 'Clients are for Sales, Finance and the Business Admin.'; end if;
  return jsonb_build_object(
    'can_move', public.can_reassign_agent(b) and b is not null,
    'business_id', b,
    'clients', coalesce((select jsonb_agg(x order by x->>'legal_name') from (
      select jsonb_build_object('id', c.id, 'business_id', c.business_id, 'store', bz.code, 'customer_code', c.customer_code, 'legal_name', c.legal_name,
               'trade_name', c.trade_name, 'contact_person', c.contact_person, 'phone', c.phone, 'email', c.email, 'address', c.address, 'tax_id', c.tax_id,
               'payment_terms', c.payment_terms, 'credit_limit', c.credit_limit, 'notes', c.notes, 'price_tier', c.price_tier, 'active', c.active,
               'agent_id', c.agent_id, 'agent', a.name, 'agent_code', a.agent_code, 'agent_kind', a.kind, 'agent_has_login', a.user_id is not null,
               'open_balance', coalesce(ob.bal, 0), 'overdue', coalesce(ob.od, 0),
               'last_sale', (select max(s.sale_date) from public.storefront_sales s where s.customer_id = c.id and s.status = 'completed')) as x
        from public.finance_customers c
        join public.businesses bz on bz.id = c.business_id
        left join public.sales_agents a on a.id = c.agent_id
        left join lateral (select sum(i.balance_due) as bal, sum(i.balance_due) filter (where coalesce(i.due_date, i.invoice_date) < today) as od
                             from public.finance_customer_invoices i where i.customer_id = c.id and i.status in ('approved', 'partially_paid')) ob on true
       where (b is null and public.is_super_admin()) or c.business_id = b) q), '[]'::jsonb),
    'agents', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'agent_code', a.agent_code, 'kind', a.kind, 'has_login', a.user_id is not null) order by a.kind desc, a.name)
                          from public.sales_agents a where a.active and (a.kind = 'freelance' or a.business_id = b)), '[]'::jsonb));
end $$;
revoke all on function public.sales_clients_list() from public;
grant execute on function public.sales_clients_list() to authenticated;

-- move clients to another agent (one or many); both agents are notified by the trigger
create or replace function public.sales_clients_move(p_customers uuid[], p_agent uuid, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare b uuid := public.current_business_id(); n int;
begin
  if b is null then raise exception 'Choose the store first ("Acting as").'; end if;
  if not public.can_reassign_agent(b) then raise exception 'Only the Sales approver or the Business Admin can move a client to another agent.'; end if;
  if coalesce(array_length(p_customers, 1), 0) = 0 then raise exception 'Choose the client(s) to move.'; end if;
  perform set_config('ibx.reassign_note', coalesce(p_note, ''), true);
  update public.finance_customers set agent_id = p_agent, updated_at = now()
   where id = any(p_customers) and business_id = b and agent_id is distinct from p_agent;
  get diagnostics n = row_count;
  perform set_config('ibx.reassign_note', '', true);
  return n;
end $$;
revoke all on function public.sales_clients_move(uuid[], uuid, text) from public;
grant execute on function public.sales_clients_move(uuid[], uuid, text) to authenticated;

-- add / edit a client from the Clients list (code by the system; agent: the store unless an approver picks one)
create or replace function public.sales_client_save(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := public.current_business_id(); v_name text := nullif(btrim(p->>'legal_name'), ''); code text; n int; c uuid; old record;
        v_fin boolean := public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance'); v_tier int;
begin
  if not public.clients_access() then raise exception 'Clients are for Sales, Finance and the Business Admin.'; end if;
  if v_name is null then raise exception 'Client name is required.'; end if;
  v_tier := coalesce(nullif(p->>'price_tier', '')::int, 1);
  if v_tier not between 1 and 4 then raise exception 'The price tier is 1 to 4.'; end if;
  if p_id is null then
    if b is null then raise exception 'Choose the store first ("Acting as").'; end if;
    if exists (select 1 from public.finance_customers where business_id = b and lower(btrim(legal_name)) = lower(v_name) and active) then
      raise exception 'A client named "%" already exists in this store.', v_name;
    end if;
    select bz.code into code from public.businesses bz where bz.id = b;
    perform pg_advisory_xact_lock(hashtext('CUS:' || code));
    select coalesce(max(substring(customer_code from length(code) + 6)::int), 0) + 1 into n
      from public.finance_customers where customer_code ~ ('^CUS-' || code || '-[0-9]+$');
    insert into public.finance_customers(business_id, customer_code, legal_name, trade_name, contact_person, phone, email, address, tax_id, payment_terms,
                                         credit_limit, notes, price_tier, active, created_by, agent_id)
    values (b, 'CUS-' || code || '-' || lpad(n::text, 5, '0'), v_name, nullif(btrim(p->>'trade_name'), ''), nullif(btrim(p->>'contact_person'), ''),
            nullif(btrim(p->>'phone'), ''), nullif(btrim(p->>'email'), ''), nullif(btrim(p->>'address'), ''), nullif(btrim(p->>'tax_id'), ''),
            nullif(btrim(p->>'payment_terms'), ''), case when v_fin then coalesce(nullif(p->>'credit_limit', '')::numeric, 0) else 0 end,
            nullif(btrim(p->>'notes'), ''), v_tier, true, auth.uid(),
            case when public.can_reassign_agent(b) then nullif(p->>'agent_id', '')::uuid end)
    returning id into c;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'finance_customers', c, 'customer_created', jsonb_build_object('from', 'clients list'));
    return c;
  end if;
  select * into old from public.finance_customers where id = p_id and (public.is_super_admin() or business_id = b);
  if not found then raise exception 'Client not found in this store.'; end if;
  perform set_config('ibx.reassign_note', coalesce(p->>'move_note', ''), true);
  update public.finance_customers
     set legal_name = v_name, trade_name = nullif(btrim(p->>'trade_name'), ''), contact_person = nullif(btrim(p->>'contact_person'), ''),
         phone = nullif(btrim(p->>'phone'), ''), email = nullif(btrim(p->>'email'), ''), address = nullif(btrim(p->>'address'), ''),
         tax_id = nullif(btrim(p->>'tax_id'), ''), payment_terms = nullif(btrim(p->>'payment_terms'), ''), notes = nullif(btrim(p->>'notes'), ''),
         credit_limit = case when v_fin and p ? 'credit_limit' then coalesce(nullif(p->>'credit_limit', '')::numeric, 0) else credit_limit end,
         price_tier = v_tier,
         agent_id = coalesce(nullif(p->>'agent_id', '')::uuid, agent_id),
         active = coalesce((p->>'active')::boolean, active), updated_at = now()
   where id = p_id;
  perform set_config('ibx.reassign_note', '', true);
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (auth.uid(), 'finance_customers', p_id, 'customer_updated', jsonb_build_object('from', 'clients list'));
  return p_id;
end $$;
revoke all on function public.sales_client_save(uuid, jsonb) from public;
grant execute on function public.sales_client_save(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------------ agent app notices (all stores)
create or replace function public.agent_notifications()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  return jsonb_build_object(
    'unread', (select count(*) from public.app_notifications where recipient_user_id = auth.uid() and read_at is null),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'message', n.message, 'store', bz.code, 'read', n.read_at is not null, 'created_at', n.created_at) order by n.created_at desc)
                         from (select * from public.app_notifications where recipient_user_id = auth.uid() order by created_at desc limit 30) n
                         join public.businesses bz on bz.id = n.business_id), '[]'::jsonb));
end $$;
revoke all on function public.agent_notifications() from public;
grant execute on function public.agent_notifications() to authenticated;

create or replace function public.agent_notifications_read()
returns void language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require();
begin
  update public.app_notifications set read_at = now() where recipient_user_id = auth.uid() and read_at is null;
end $$;
revoke all on function public.agent_notifications_read() from public;
grant execute on function public.agent_notifications_read() to authenticated;

-- ------------------------------------------------------------------ delete a login (only when it has no records)
create or replace function public.user_delete(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare u record; v_tbl text; v_label text;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only an admin can delete logins.'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own login.'; end if;
  select * into u from public.users where id = p_user;
  if not found then raise exception 'User not found.'; end if;
  if not public.is_super_admin() and (u.business_id is distinct from public.current_business_id() or u.role::text in ('super_admin', 'business_admin')) then
    raise exception 'User not found.';
  end if;
  if u.role::text = 'super_admin' and u.is_active and (select count(*) from public.users where role::text = 'super_admin' and is_active) <= 1 then
    raise exception 'At least one active Super Admin must remain.';
  end if;
  begin
    update public.sales_agents set user_id = null where user_id = p_user;
    update public.employees set user_id = null where user_id = p_user;   -- the employee record stays
    delete from public.users where id = p_user;
  exception when foreign_key_violation then
    get stacked diagnostics v_tbl = table_name;
    v_label := replace(coalesce(v_tbl, 'records'), '_', ' ');
    raise exception '% already has records in the app (e.g. %), so the login cannot be deleted without losing that history. Deactivate it instead.',
      coalesce(nullif(btrim(u.full_name), ''), u.email), v_label;
  end;
  return u.email;
end $$;
revoke all on function public.user_delete(uuid) from public;
grant execute on function public.user_delete(uuid) to authenticated;
