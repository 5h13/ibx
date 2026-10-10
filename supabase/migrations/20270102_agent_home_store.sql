-- Build 97e — agents belong to the store(s) they work in. A store sees only its own agents: its walk-in
-- account, agents created in that store (home store), and agents with clients or sales there.
alter table public.sales_agents add column if not exists home_business_id uuid references public.businesses(id);

create or replace function public.sales_agent_home() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'store' then new.home_business_id := new.business_id;
  elsif new.home_business_id is null then new.home_business_id := coalesce(public.current_business_id(), public.super_admin_view_business());
  end if;
  return new;
end $$;
revoke all on function public.sales_agent_home() from public, authenticated;
drop trigger if exists sales_agents_home on public.sales_agents;
create trigger sales_agents_home before insert on public.sales_agents for each row execute function public.sales_agent_home();

-- existing agents: the store where most of their clients are, else most of their sales, else the creator's store
update public.sales_agents a set home_business_id = coalesce(
    (select c.business_id from public.finance_customers c where c.agent_id = a.id and c.business_id is not null group by 1 order by count(*) desc limit 1),
    (select s.business_id from public.storefront_sales s where s.agent_id = a.id group by 1 order by count(*) desc limit 1),
    (select u.business_id from public.users u where u.id = a.created_by))
 where a.kind = 'freelance' and a.home_business_id is null;
update public.sales_agents set home_business_id = business_id where kind = 'store' and home_business_id is null;

-- which agents work in which store (home store, clients there, or sales there); a store user sees his store only
create or replace function public.sales_agent_stores()
returns table(agent_id uuid, business_id uuid) language sql stable security definer set search_path = public as $$
  with scope as (select coalesce(public.current_business_id(), public.super_admin_view_business()) as b)
  select distinct x.agent_id, x.business_id from (
    select a.id as agent_id, a.home_business_id as business_id from public.sales_agents a where a.home_business_id is not null
    union select c.agent_id, c.business_id from public.finance_customers c where c.agent_id is not null and c.business_id is not null
    union select s.agent_id, s.business_id from public.storefront_sales s where s.agent_id is not null
  ) x, scope
  where (scope.b is null and public.is_super_admin()) or x.business_id = scope.b;
$$;
revoke all on function public.sales_agent_stores() from public;
grant execute on function public.sales_agent_stores() to authenticated;

-- Clients list: the agent pick-list marks this store's own agents (others are listed under "Other agents")
do $$
declare src text := pg_get_functiondef('public.sales_clients_list()'::regprocedure);
begin
  if position('''has_login'', a.user_id is not null) order by a.kind desc, a.name)' in src) = 0 then raise exception 'Unexpected sales_clients_list'; end if;
  src := replace(src, '''has_login'', a.user_id is not null) order by a.kind desc, a.name)',
                 '''has_login'', a.user_id is not null, ''in_store'', a.kind = ''store'' or exists (select 1 from public.sales_agent_stores() z where z.agent_id = a.id)) order by a.kind desc, a.name)');
  execute src;
end $$;
