-- Build 129 (UIA-22) — an agent's quotation always waits for office approval (review, then
-- approve by the Sales approver), whatever the store's operating mode. Single-operator mode set the
-- Quotation point to Auto, so an agent's quote was approved in the agent's own name the moment it
-- was sent. The store's own documents keep following the mode.
-- How: the quotation's approval rule is recorded as two-step before the quotation is inserted;
-- the operating-mode trigger keeps an existing rule (on conflict do nothing) and reads it.

create or replace function public.agent_quote_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid := public.agent_require(); b uuid := (p->>'business_id')::uuid; c public.finance_customers; l jsonb; lp record; v_q uuid := gen_random_uuid(); v_sub numeric := 0; v_qty numeric;
        v_today date := (now() at time zone 'Asia/Manila')::date; v_user uuid := auth.uid(); v_mode text;
begin
  perform public.agent_check_store(b);
  c := public.agent_client((p->>'customer_id')::uuid, b);
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item.'; end if;
  select coalesce(m.mode, 'full') into v_mode from public.businesses x left join public.business_operating_modes m on m.business_id = x.id where x.id = b;
  insert into public.workflow_document_rules(entity_table, entity_id, business_id, point, setting, mode)
  values ('sales_quotations', v_q, b, 'quote', 'two_step', coalesce(v_mode, 'full'))
  on conflict do nothing;
  insert into public.sales_quotations(id, business_id, customer_id, quotation_date, valid_until, subtotal, discount_amount, tax_amount, other_charges,
                                      status, notes, payment_terms, delivery_lead_time, prepared_by, prepared_at, created_by)
  values (v_q, b, c.id, v_today, coalesce(nullif(p->>'valid_until', '')::date, v_today + 15), 0, 0, 0, 0, 'prepared',
          nullif(btrim(p->>'notes'), ''), nullif(btrim(p->>'payment_terms'), ''), nullif(btrim(p->>'delivery_lead_time'), ''), v_user, now(), v_user);
  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := round(coalesce((l->>'quantity')::numeric, 0), 3);
    if v_qty <= 0 then raise exception 'Every line needs a quantity.'; end if;
    select * into lp from public.agent_line_price(b, c.id, (l->>'item_id')::uuid, nullif(l->>'tier', '')::int, nullif(l->>'unit_price', '')::numeric);
    insert into public.sales_quotation_items(business_id, quotation_id, catalog_item_id, description, quantity, unit, unit_price,
                                             pricing_acquisition_cost, pricing_srp, pricing_item_type, pricing_snapshot_at, notes)
    values (b, v_q, lp.item_id, lp.item_name, v_qty, coalesce(lp.unit, 'unit'), lp.unit_price, lp.acquisition_cost, lp.list_price,
            coalesce(lp.item_type, 'product'), now(), case when nullif(l->>'tier', '') is not null then 'Tier ' || (l->>'tier') end);
    v_sub := v_sub + round(v_qty * lp.unit_price, 2);
  end loop;
  update public.sales_quotations set subtotal = v_sub where id = v_q;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail) values (v_user, 'sales_quotations', v_q, 'agent_quotation_prepared', jsonb_build_object('agent_id', v, 'subtotal', v_sub, 'approval', 'office (two steps)'));
  return v_q;
end $$;
revoke all on function public.agent_quote_save(jsonb) from public;
grant execute on function public.agent_quote_save(jsonb) to authenticated;
