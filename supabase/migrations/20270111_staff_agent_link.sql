-- Build 106 — one login for staff who also sell as agents.
--   A staff login (sales, finance, …, business_admin) can be linked to a freelance agent record. The person then
--   switches between the office screens and the agent app with one login ("Agent app" / "Back to office").
--   Rights do not mix: in the agent app they act only as that agent (every agent RPC goes through current_agent_id);
--   on the office screens only their staff access applies. Super Admin accounts are never linked.

create or replace function public.current_agent_id()
returns uuid language sql stable security definer set search_path = public as $$
  select a.id from public.sales_agents a join public.users u on u.id = a.user_id
   where a.user_id = auth.uid() and a.active and a.kind = 'freelance' and u.is_active and u.role::text <> 'super_admin'
   limit 1;
$$;

create or replace function public.sales_agent_link_user(p_agent uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare u record; a record;
begin
  if not (public.is_super_admin() or public.is_business_admin()) then raise exception 'Only a Business Admin links agent logins.'; end if;
  select * into u from public.users where id = p_user;
  if not found then raise exception 'User not found.'; end if;
  if public.is_business_admin() and not public.is_super_admin() and u.business_id is distinct from public.current_business_id() then
    raise exception 'That user belongs to another store.';
  end if;
  update public.sales_agents set user_id = null, updated_at = now() where user_id = p_user and id is distinct from p_agent;
  if p_agent is null then return; end if;
  if u.role::text = 'super_admin' then raise exception 'A Super Admin account cannot be linked to an agent.'; end if;
  select * into a from public.sales_agents where id = p_agent;
  if not found or a.kind <> 'freelance' then raise exception 'Only a freelance agent can have a login.'; end if;
  if a.user_id is not null and a.user_id <> p_user then raise exception '% already has a login.', a.name; end if;
  update public.sales_agents set user_id = p_user, updated_at = now() where id = p_agent;
end $$;
