-- Build 97h — owner decisions (2026-10-10):
--  * the Back Office "agent share" plan is removed: store agents (e.g. Raymart) are paid by the agent engine on % of gross (Build 94);
--  * the store's own sales for the "sales staff" plan = the walk-in Store account + the store agents' sales (Ikot–Raymart is store;
--    freelance agents such as Arnold stay agent sales);
--  * PILI pays no store staff commission (no plan to set up; nothing to change here).
do $$
declare src text := pg_get_functiondef('public.bo_commission_calc(uuid, date)'::regprocedure);
  old1 text := $o$  select id into v_store_agent from public.sales_agents where business_id = p_business and kind = 'store';
  v_store_paid := case when v_store_agent is null then 0 else public.bo_paid_gross(p_business, v_store_agent, v_from, v_to) end;$o$;
  new1 text := $n$  -- Build 97h: the store's own sales = the walk-in Store account + the store agents (paid on % of gross, e.g. Raymart)
  select coalesce(sum(public.bo_paid_gross(p_business, g.id, v_from, v_to)), 0) into v_store_paid from public.sales_agents g
   where (g.kind = 'store' and g.business_id = p_business) or (g.kind = 'freelance' and g.commission_basis = 'gross');$n$;
  old2 text := 'for p in select * from public.bo_plans where business_id = p_business and active order by';
  new2 text := 'for p in select * from public.bo_plans where business_id = p_business and active and kind <> ''agent_share'' order by';
begin
  if position(old1 in src) = 0 or position(old2 in src) = 0 then raise exception 'Unexpected bo_commission_calc'; end if;
  execute replace(replace(src, old1, new1), old2, new2);
end $$;

do $$
declare src text := pg_get_functiondef('public.bo_commission_setup_save(jsonb)'::regprocedure);
  old1 text := $o$if (x->>'kind') = 'agent_share' and nullif(x->>'agent_id', '') is null then raise exception '%: choose the agent.', x->>'label'; end if;$o$;
  new1 text := $n$if (x->>'kind') = 'agent_share' and coalesce((x->>'active')::boolean, true) then raise exception '%: the agent share plan was removed — store agents are paid on %% of gross (Sales → Agent Commissions → How paid).', x->>'label'; end if;$n$;
begin
  if position(old1 in src) = 0 then raise exception 'Unexpected bo_commission_setup_save'; end if;
  execute replace(src, old1, new1);
end $$;

update public.bo_plans set active = false where kind = 'agent_share' and active;
