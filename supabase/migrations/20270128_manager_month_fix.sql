-- Build 128 — Sales Manager app: Team and Sales did not load. manager_month and manager_client
-- built their figures in temporary tables, which the live database refuses for app requests
-- (read-only request / no temporary tables); the Today, Approvals and Collections screens, which
-- use none, loaded. Same figures, now worked out in one read-only query each.

create or replace function public.manager_month(p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); v_from date := make_date(p_year, p_month, 1);
        v_to date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_end date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  if v_b is null then return jsonb_build_object('no_store', true); end if;
  v_end := least(v_to, v_today);
  return (
    with l as materialized (select * from public.manager_sales_lines(v_b, v_from, v_end)),
         prev as materialized (select customer_id, sum(amount) total from public.manager_sales_lines(v_b, (v_from - interval '1 month')::date, (v_from - 1)) group by customer_id),
         arx as materialized (select * from public.manager_ar(v_b)),
         tot as (select coalesce(sum(amount), 0) total, coalesce(sum(net), 0) net, coalesce(sum(cost), 0) cost from l)
    select jsonb_build_object(
      'from', v_from, 'to', v_to, 'through', v_end, 'days_in_month', extract(day from v_to)::int, 'days_gone', greatest(0, (v_end - v_from) + 1),
      'total', round(tot.total, 2), 'margin', case when tot.net > 0 then round((tot.net - tot.cost) / tot.net * 100, 1) end,
      'target', public.manager_store_target(v_b, p_year, p_month),
      'days', (select jsonb_agg(jsonb_build_object('d', d::date, 'total', round(coalesce((select sum(amount) from l where l.day = d::date), 0), 2)) order by d)
                 from generate_series(v_from::timestamp, v_end::timestamp, interval '1 day') d),
      'by_category', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('name', category, 'total', round(sum(amount), 2),
                 'margin', case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end) x
            from l group by category) c), '[]'::jsonb),
      'by_channel', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('name', ch, 'total', round(sum(amount), 2), 'margin', case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end) x
            from (select case when agent_id is null then 'Counter' when online then 'Online' else 'Agents' end ch, amount, net, cost from l) y group by ch) c), '[]'::jsonb),
      'by_client', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('id', g.customer_id, 'name', coalesce(c.trade_name, c.legal_name, 'Walk-in (no account)'), 'total', round(g.total, 2),
                 'margin', case when g.net > 0 then round((g.net - g.cost) / g.net * 100, 1) end,
                 'sales', g.sales, 'last', g.last, 'agent', a.name,
                 'prev', (select round(coalesce(sum(p.total), 0), 2) from prev p where p.customer_id is not distinct from g.customer_id),
                 'overdue', (select round(coalesce(ar.overdue, 0), 2) from arx ar where ar.customer_id = g.customer_id)) x
            from (select customer_id, sum(amount) total, sum(net) net, sum(cost) cost, count(distinct sale_id) sales, max(day) last
                    from l group by customer_id order by sum(amount) desc limit 12) g
            left join public.finance_customers c on c.id = g.customer_id
            left join public.sales_agents a on a.id = c.agent_id and a.kind <> 'store') z), '[]'::jsonb),
      'open_quotes', (select jsonb_build_object('total', round(coalesce(sum(total_amount), 0), 2), 'count', count(*), 'older7', count(*) filter (where quotation_date < v_today - 7))
                        from public.sales_quotations where business_id = v_b and status::text in ('draft', 'prepared', 'reviewed', 'approved', 'sent')),
      'orders_open', (select jsonb_build_object('total', round(coalesce(sum(total_amount), 0), 2), 'count', count(*))
                        from public.sales_orders where business_id = v_b and status::text in ('approved', 'processing')))
    from tot);
end $$;
revoke all on function public.manager_month(int, int) from public;
grant execute on function public.manager_month(int, int) to authenticated;

create or replace function public.manager_client(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := public.current_business_id(); c record; v_today date := (now() at time zone 'Asia/Manila')::date;
        v_m0 date := date_trunc('month', (now() at time zone 'Asia/Manila'))::date; v_y0 date := date_trunc('year', (now() at time zone 'Asia/Manila'))::date;
begin
  if not public.manager_access() then raise exception 'The Sales Manager app is for Sales approvers and the Business Admin.'; end if;
  select * into c from public.finance_customers where id = p_customer and business_id = v_b;
  if not found then raise exception 'Client not found in this store.'; end if;
  return (
    with l as materialized (select * from public.manager_sales_lines(v_b, (v_m0 - interval '11 months')::date, v_today) where customer_id = p_customer)
    select jsonb_build_object(
      'id', c.id, 'name', coalesce(c.trade_name, c.legal_name), 'phone', c.phone, 'contact', c.contact_person, 'terms', c.payment_terms, 'since', c.created_at::date,
      'credit_limit', c.credit_limit, 'agent', (select name from public.sales_agents where id = c.agent_id and kind <> 'store'),
      'month', round(coalesce((select sum(amount) from l where day >= v_m0), 0), 2),
      'prev_month', round(coalesce((select sum(amount) from l where day >= (v_m0 - interval '1 month')::date and day < v_m0), 0), 2),
      'year', round(coalesce((select sum(amount) from l where day >= v_y0), 0), 2),
      'year_margin', (select case when sum(net) > 0 then round((sum(net) - sum(cost)) / sum(net) * 100, 1) end from l where day >= v_y0),
      'ar', (select jsonb_build_object('owed', round(coalesce(owed, 0), 2), 'overdue', round(coalesce(overdue, 0), 2), 'invoices', invoices, 'oldest_due', oldest_due) from public.manager_ar(v_b) where customer_id = p_customer),
      'months', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'Mon'), 'total', round(coalesce((select sum(amount) from l where date_trunc('month', l.day) = m), 0), 2)) order by m)
                   from generate_series((v_m0 - interval '5 months'), v_m0::timestamp, interval '1 month') m),
      'categories', coalesce((select jsonb_agg(x order by (x->>'total')::numeric desc) from (
          select jsonb_build_object('name', category, 'total', round(sum(amount), 2)) x from l where day >= v_y0 and category <> 'Returns' group by category) y), '[]'::jsonb),
      -- bought in at least 3 of the 6 months before the last 60 days, nothing since
      'lapsed', coalesce((select jsonb_agg(category) from (
          select category from l where category not in ('Returns', 'Uncategorised')
           group by category
          having count(distinct date_trunc('month', day)) filter (where day >= v_today - 240 and day < v_today - 60) >= 3
             and count(*) filter (where day >= v_today - 60) = 0) z), '[]'::jsonb),
      'recent', coalesce((select jsonb_agg(r order by r->>'date' desc) from (
          select jsonb_build_object('kind', 'sale', 'number', coalesce(s.dr_number, s.si_number, s.sale_number), 'date', s.sale_date, 'total', s.total, 'balance', s.balance,
                   'items', (select string_agg(si.description || ' × ' || trim(to_char(si.quantity, 'FM999990.##')), ', ' order by si.line_total desc) from public.storefront_sale_items si where si.sale_id = s.id)) r
            from public.storefront_sales s where s.customer_id = p_customer and s.business_id = v_b and s.status = 'completed'
           order by s.sale_date desc, s.created_at desc limit 6) y), '[]'::jsonb),
      'open_quotes', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'number', q.quotation_number, 'date', q.quotation_date, 'total', q.total_amount, 'status', q.status) order by q.quotation_date desc)
                      from public.sales_quotations q where q.customer_id = p_customer and q.business_id = v_b and q.status::text in ('prepared', 'reviewed', 'approved', 'sent')), '[]'::jsonb),
      'promises', coalesce((select jsonb_agg(jsonb_build_object('date', p.promise_date, 'amount', p.amount, 'note', p.note, 'logged', p.created_at::date) order by p.created_at desc)
                      from (select * from public.collection_promises where customer_id = p_customer order by created_at desc limit 5) p), '[]'::jsonb),
      'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.invoice_number, 'date', i.invoice_date, 'due', i.due_date, 'total', i.total_amount, 'balance', i.balance_due) order by i.due_date nulls last, i.invoice_date)
                      from public.finance_customer_invoices i where i.customer_id = p_customer and i.business_id = v_b and coalesce(i.balance_due, 0) > 0 and i.status::text not in ('draft', 'voided', 'paid')), '[]'::jsonb)));
end $$;
revoke all on function public.manager_client(uuid) from public;
grant execute on function public.manager_client(uuid) to authenticated;
