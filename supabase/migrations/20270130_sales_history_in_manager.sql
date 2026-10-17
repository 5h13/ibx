-- Build 130 — the stores' sales history (Jan–Oct 2026) shows in the Sales Manager app.
-- The history was loaded as one counter sale per DR (DR number, date, client, agent, total; no item
-- lines), with one "Sales history (loaded)" journal per store per month that the Dashboard reads.
-- The Manager app counted sales through their item lines, so a sale without lines was left out:
-- PILI showed ₱0 for August. Now a sale without item lines counts at its total, under
-- "Sales history". Its cost is unknown, so it is left out of every margin (net and cost are null).

create or replace function public.manager_sales_lines(p_business uuid, p_from date, p_to date)
returns table(day date, sale_id uuid, customer_id uuid, agent_id uuid, staff_id uuid, online boolean, category text, amount numeric, net numeric, cost numeric)
language sql stable security definer set search_path = public as $$
  with sales as (
    select s.* from public.storefront_sales s
     where s.business_id = p_business and s.status = 'completed' and s.sale_date between p_from and p_to
  )
  select s.sale_date, s.id, s.customer_id, case when a.id is null then null else s.agent_id end, s.created_by, coalesce(a.online, false),
         coalesce(nullif(btrim(i.category), ''), 'Uncategorised'),
         -- the sale's total (VAT, any whole-sale discount) spread over its lines by line value
         case when sum(si.line_total) over (partition by s.id) <> 0 then si.line_total / sum(si.line_total) over (partition by s.id) * s.total else s.total / count(*) over (partition by s.id) end,
         case when sum(si.line_total) over (partition by s.id) <> 0 then si.line_total / sum(si.line_total) over (partition by s.id) * (s.total - coalesce(s.vat_amount, 0)) else (s.total - coalesce(s.vat_amount, 0)) / count(*) over (partition by s.id) end,
         coalesce(si.unit_cost, si.acquisition_cost, 0) * si.quantity
    from sales s join public.storefront_sale_items si on si.sale_id = s.id
    left join public.finance_procurement_items i on i.id = si.item_id
    left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
  union all
  -- a sale recorded by its DR total only (the loaded history): counted at its total, no margin
  select s.sale_date, s.id, s.customer_id, case when a.id is null then null else s.agent_id end, s.created_by, coalesce(a.online, false),
         'Sales history', s.total, null::numeric, null::numeric
    from sales s
    left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
   where not exists (select 1 from public.storefront_sale_items si where si.sale_id = s.id)
  union all
  select r.return_date, s.id, s.customer_id, case when a.id is null then null else s.agent_id end, s.created_by, coalesce(a.online, false), 'Returns',
         -r.total, -(r.total - coalesce(r.vat_amount, 0)), -coalesce(r.cost_total, 0)
    from public.storefront_returns r join public.storefront_sales s on s.id = r.sale_id
    left join public.sales_agents a on a.id = s.agent_id and a.kind <> 'store'
   where r.business_id = p_business and r.return_date between p_from and p_to;
$$;
revoke all on function public.manager_sales_lines(uuid, date, date) from public;

-- Client screen: "stopped buying" looks at real categories only (not "Sales history").
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
          select category from l where category not in ('Returns', 'Uncategorised', 'Sales history')
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
