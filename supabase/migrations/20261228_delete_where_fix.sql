-- Build 93a — Supabase refuses a DELETE without a WHERE clause from API sessions ("DELETE requires a WHERE
-- clause", safeupdate). Three functions emptied a scratch table with a bare DELETE:
--   agent_commission_month_calc (Agent Commissions, My Commission), bo_commission_calc (Back Office Commission),
--   post_transfer_to_stock (stock transfers). They now say "where true".
do $$
declare r record; d text; n text;
begin
  for r in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.proname in ('agent_commission_month_calc', 'bo_commission_calc', 'post_transfer_to_stock') loop
    d := pg_get_functiondef(r.oid);
    n := regexp_replace(d, 'delete from (_acl|_bol|tmp_transfer_alloc)\s*;', 'delete from \1 where true;', 'gi');
    if n <> d then execute n; end if;
  end loop;
end $$;
