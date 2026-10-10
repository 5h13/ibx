-- Build 97a — the Clients list follows the Super Admin's "Acting as" store (it showed every store).
-- current_business_id() is empty for a Super Admin; the acting store is super_admin_view_business().
do $$
declare f text; src text;
begin
  foreach f in array array['public.sales_clients_list()', 'public.sales_clients_move(uuid[], uuid, text)', 'public.sales_client_save(uuid, jsonb)'] loop
    src := pg_get_functiondef(f::regprocedure);
    if position('b uuid := public.current_business_id();' in src) = 0 then raise exception 'Unexpected definition of %', f; end if;
    src := replace(src, 'b uuid := public.current_business_id();', 'b uuid := coalesce(public.current_business_id(), public.super_admin_view_business());');
    execute src;
  end loop;
end $$;

create or replace function public.can_reassign_agent(p_business uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is null
      or public.is_super_admin()
      or (p_business = public.current_business_id() and (public.is_business_admin()
          or exists (select 1 from public.user_access ua join public.sections s on s.id = ua.section_id
                      where ua.user_id = auth.uid() and s.code = 'sales' and ua.workflow_role = 'approver')));
$$;
