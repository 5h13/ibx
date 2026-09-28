-- ============================================================================
-- Build 73 — Finance visibility and charge-sale controls (user, 2026-09-28):
--   SF-26  Approving a closing links payments that have no receiving account
--          to the store's only account for that method, or stops with a
--          set-up message — no payment is left out of Bank/Cash again.
--   SF-25  Posting a journal creates the month record when it is missing, so
--          a posted journal always reaches the month's figures.
--   SF-13  Charge / partly paid counter sales: the AR invoice gets a due date
--          from the customer's payment terms; charging a customer who is over
--          the credit limit or has overdue invoices needs a Sales approver /
--          Business Admin (the cashier is stopped; an approver can complete it,
--          audited). (The AR status already follows receipts since Build 71.)
--   SF-28  Dashboard layers: today's counter sales (preliminary, straight from
--          the Storefront), and Finance-approved figures (posted journals) for
--          a month, quarter or year, per store.
-- ============================================================================

-- ------------------------------------------------------------------ SF-26 --
create or replace function public.storefront_post_closing(p_closing uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c record; b uuid; v_code text; gl jsonb := '{}'; bank jsonb := '{}'; p record; x record; v_je uuid; v_jno text;
        v_rev_net numeric; v_vat numeric; v_ret_net numeric; v_ret_vat numeric; v_ar_charged numeric; v_ar_credit numeric; v_ar_coll numeric;
        v_cogs numeric; v_ret_cost numeric; v_drawer uuid; v_drawer_gl uuid; d numeric; cr numeric; v_section uuid; v_tno text; v_n int; v_acc uuid;
begin
  select * into c from public.storefront_closings where id = p_closing for update;
  if c.journal_entry_id is not null then return c.journal_entry_id; end if;
  b := c.business_id;
  select code into v_code from public.businesses where id = b;
  select id into v_section from public.sections where code = 'sales';
  select id, coalesce(gl_account_id, public.sf_gl(b, '1000')) into v_drawer, v_drawer_gl
    from public.finance_bank_accounts where business_id = b and payment_method = 'cash' and status = 'active' order by (account_code = 'SF-CASH') desc limit 1;
  if v_drawer_gl is null then v_drawer_gl := public.sf_gl(b, '1000'); end if;

  -- Build 71d: every payment must name the account that received it before
  -- the day goes to Finance. Payments recorded before receiving accounts
  -- existed get the store's only account for their method; with none (or
  -- several) the approval stops and says what to set up.
  for p in select sp.id, sp.payment_number, sp.method, sp.amount from public.storefront_payments sp
            where sp.closing_id = c.id and sp.bank_account_id is null loop
    select count(*), min(id::text)::uuid into v_n, v_acc from public.finance_bank_accounts
     where business_id = b and payment_method = p.method and status = 'active';
    if v_n = 1 then
      update public.storefront_payments set bank_account_id = v_acc where id = p.id;
    elsif v_n = 0 then
      raise exception 'Payment % (% ₱%) has no receiving account and this store has no % account yet: a Business Admin adds it in Storefront → Store settings → Receiving accounts, then approve again.',
        p.payment_number, p.method, p.amount, case p.method when 'gcash' then 'GCash' when 'maya' then 'Maya' when 'card' then 'card' when 'cash' then 'cash drawer' else 'bank' end;
    else
      raise exception 'Payment % (% ₱%) has no receiving account and this store has several % accounts; it cannot be linked automatically. Ask the Super Admin to set which account received it, then approve again.',
        p.payment_number, p.method, p.amount, p.method;
    end if;
  end loop;

  -- money in / out by receiving account
  for p in select sp.*, a.gl_account_id from public.storefront_payments sp left join public.finance_bank_accounts a on a.id = sp.bank_account_id
            where sp.closing_id = c.id loop
    gl := public.sf_jadd(gl, coalesce(p.gl_account_id, public.sf_default_gl(b, p.method)), case when p.kind = 'refund' then -p.amount else p.amount end);
    bank := public.sf_badd(bank, p.bank_account_id, case when p.kind = 'refund' then -p.amount else p.amount end);
  end loop;

  -- sales, VAT, AR
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(balance), 0), coalesce(sum(cost_total), 0)
    into v_rev_net, v_vat, v_ar_charged, v_cogs from public.storefront_sales where closing_id = c.id and status = 'completed';
  select coalesce(sum(total - vat_amount), 0), coalesce(sum(vat_amount), 0), coalesce(sum(credit_to_ar), 0), coalesce(sum(cost_total), 0)
    into v_ret_net, v_ret_vat, v_ar_credit, v_ret_cost from public.storefront_returns where closing_id = c.id;
  select coalesce(sum(amount), 0) into v_ar_coll from public.storefront_payments where closing_id = c.id and kind = 'ar_collection';

  gl := public.sf_jadd(gl, public.sf_gl(b, '4000'), -v_rev_net);          -- Cr sales (net of VAT)
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), -v_vat);              -- Cr output VAT
  gl := public.sf_jadd(gl, public.sf_gl(b, '4010'), v_ret_net);           -- Dr sales returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '2210'), v_ret_vat);           -- Dr output VAT on returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '1100'), v_ar_charged - v_ar_coll - v_ar_credit); -- AR: charged − collected − credited by returns
  gl := public.sf_jadd(gl, public.sf_gl(b, '5000'), v_cogs - v_ret_cost); -- Dr cost of sales
  gl := public.sf_jadd(gl, public.sf_gl(b, '1200'), v_ret_cost - v_cogs); -- Cr inventory

  -- cash taken out of the drawer
  for x in select * from public.storefront_cash_movements where closing_id = c.id and kind = 'cash_out' loop
    gl := public.sf_jadd(gl, v_drawer_gl, -x.amount);
    bank := public.sf_badd(bank, v_drawer, -x.amount);
    if x.category = 'bank_deposit' then
      gl := public.sf_jadd(gl, coalesce((select gl_account_id from public.finance_bank_accounts where id = x.bank_account_id), public.sf_gl(b, '1010')), x.amount);
      bank := public.sf_badd(bank, x.bank_account_id, x.amount);
    elsif x.category = 'petty_cash' then gl := public.sf_jadd(gl, public.sf_gl(b, '1005'), x.amount);
    else gl := public.sf_jadd(gl, public.sf_gl(b, '1090'), x.amount);
    end if;
  end loop;

  -- cash short / over
  gl := public.sf_jadd(gl, v_drawer_gl, c.variance);
  gl := public.sf_jadd(gl, public.sf_gl(b, '5010'), -c.variance);
  bank := public.sf_badd(bank, v_drawer, c.variance);

  select coalesce(sum(greatest(value::numeric, 0)), 0), coalesce(sum(greatest(-value::numeric, 0)), 0) into d, cr
    from jsonb_each_text(gl) where round(value::numeric, 2) <> 0;
  if round(d, 2) <> round(cr, 2) then raise exception 'Closing % does not balance (debit % / credit %).', c.closing_number, d, cr; end if;

  if d > 0 then
    v_jno := public.storefront_next_number(v_code || '-SFJ', 'finance_journal_entries', 'journal_number');
    insert into public.finance_journal_entries(business_id, journal_number, entry_date, description, source_module, source_record_id, section_id, status,
                                               total_debit, total_credit, prepared_by, prepared_at, created_by, notes)
    values (b, v_jno, c.closing_date, 'Storefront daily closing ' || c.closing_number || ' (' || c.closing_date || ')', 'storefront', c.id, v_section, 'prepared',
            round(d, 2), round(cr, 2), auth.uid(), now(), auth.uid(),
            'Created when the daily closing was approved. Sales ₱' || c.sales_total || ' (VAT ₱' || c.vat_total || '), returns ₱' || c.returns_total || ', cash variance ₱' || c.variance || '.')
    returning id into v_je;
    insert into public.finance_journal_lines(business_id, journal_entry_id, account_id, line_description, debit, credit, department)
    select b, v_je, key::uuid, coa.account_name || ' — ' || c.closing_number,
           case when round(value::numeric, 2) > 0 then round(value::numeric, 2) else 0 end,
           case when round(value::numeric, 2) < 0 then round(-value::numeric, 2) else 0 end, 'Storefront'
      from jsonb_each_text(gl) join public.finance_chart_of_accounts coa on coa.id = key::uuid
     where round(value::numeric, 2) <> 0;
  end if;

  -- one Bank/Cash transaction per account (net), for Finance to review and post
  for x in select key::uuid as account_id, round(value::numeric, 2) as amount from jsonb_each_text(bank) where round(value::numeric, 2) <> 0 loop
    v_tno := public.storefront_next_number(v_code || '-SFT', 'finance_cash_transactions', 'transaction_number');
    insert into public.finance_cash_transactions(business_id, transaction_number, bank_account_id, transaction_date, transaction_type, amount, direction, description,
                                                 reference_number, source_module, source_record_id, status, prepared_by, prepared_at, created_by)
    values (b, v_tno, x.account_id, c.closing_date, case when x.amount > 0 then 'deposit' else 'withdrawal' end::public.cash_transaction_type, abs(x.amount),
            case when x.amount > 0 then 'in' else 'out' end, 'Storefront daily closing ' || c.closing_number || ' (net for the day)',
            c.closing_number, 'storefront', c.id, 'prepared', auth.uid(), now(), auth.uid());
  end loop;

  update public.storefront_closings set journal_entry_id = v_je, posted_at = now() where id = c.id;
  insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
  values (auth.uid(), 'storefront_closings', c.id, 'storefront_closing_sent_to_finance', jsonb_build_object('journal', v_jno, 'total', d));
  return v_je;
end $$;
revoke all on function public.storefront_post_closing(uuid) from public, authenticated;

-- ------------------------------------------------------------------ SF-25 --
create or replace function public.refresh_financial_summary_from_ledger(p_entry_date date, p_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mid uuid; y int := extract(year from p_entry_date)::int; m int := extract(month from p_entry_date)::int;
begin
  if p_business_id is null then return; end if;
  if not public.is_super_admin() and p_business_id is distinct from public.current_business_id() then
    raise exception 'Cannot refresh another business''s financial summary.';
  end if;
  select id into mid from public.months where business_id = p_business_id and year = y and month = m;
  if mid is null then   -- Build 73: create the month instead of skipping the refresh
    insert into public.months(business_id, year, month, label)
    values (p_business_id, y, m, to_char(make_date(y, m, 1), 'FMMonth YYYY'))
    on conflict (business_id, year, month) do nothing;
    select id into mid from public.months where business_id = p_business_id and year = y and month = m;
  end if;
  delete from public.financial_summary where business_id = p_business_id and section_id is null and month_id = mid;
  insert into public.financial_summary(business_id, section_id, month_id, total_sales, total_expenses, bottomline, total_commission, computed_at)
  select p_business_id, null, mid,
    coalesce(sum(case when coa.account_type = 'revenue' then jl.credit - jl.debit else 0 end), 0),
    coalesce(sum(case when coa.account_type = 'expense' then jl.debit - jl.credit else 0 end), 0),
    coalesce(sum(case when coa.account_type = 'revenue' then jl.credit - jl.debit when coa.account_type = 'expense' then -(jl.debit - jl.credit) else 0 end), 0),
    0, now()
  from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id = je.id join public.finance_chart_of_accounts coa on coa.id = jl.account_id
  where je.business_id = p_business_id and je.status = 'posted' and extract(year from je.entry_date) = y and extract(month from je.entry_date) = m;
end $$;

-- ------------------------------------------------------------------ SF-13 --
-- days from payment terms text: "30 days", "Net 15", "15" → 15/30; COD / cash / blank → 0
create or replace function public.payment_terms_days(p_terms text)
returns int language sql immutable as $$
  select coalesce(nullif(substring(coalesce(p_terms, '') from '([0-9]{1,3})'), '')::int, 0);
$$;

create or replace function public.guard_storefront_charge_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare c record; v_open numeric; v_overdue int; v_new numeric; v_reason text;
begin
  if coalesce(new.notes, '') not like 'Storefront sale%' then return new; end if;
  select * into c from public.finance_customers where id = new.customer_id;
  if new.due_date is null then new.due_date := new.invoice_date + public.payment_terms_days(c.payment_terms); end if;
  v_new := coalesce(new.subtotal, 0) + coalesce(new.tax_amount, 0) + coalesce(new.other_charges, 0) - coalesce(new.discount_amount, 0) - coalesce(new.amount_received, 0);
  if v_new <= 0 then return new; end if;   -- fully paid at the counter: nothing is charged
  select coalesce(sum(balance_due), 0), count(*) filter (where due_date < (now() at time zone 'Asia/Manila')::date and balance_due > 0)
    into v_open, v_overdue
    from public.finance_customer_invoices
   where customer_id = new.customer_id and business_id = new.business_id and status in ('approved','partially_paid') and balance_due > 0;
  if coalesce(c.credit_limit, 0) > 0 and v_open + v_new > c.credit_limit then
    v_reason := format('is over the credit limit of ₱%s (already owes ₱%s, this sale adds ₱%s)', c.credit_limit, v_open, v_new);
  elsif v_overdue > 0 then
    v_reason := format('has %s overdue invoice(s) (owes ₱%s)', v_overdue, v_open);
  end if;
  if v_reason is not null then
    if not public.can_approve_storefront() then
      raise exception 'Cannot charge %: the customer %. Take full payment, or ask a Sales approver / Business Admin to complete this sale.', c.legal_name, v_reason;
    end if;
    insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
    values (auth.uid(), 'finance_customers', c.id, 'storefront_credit_override', jsonb_build_object('reason', v_reason, 'amount', v_new, 'invoice_number', new.invoice_number));
  end if;
  return new;
end $$;
drop trigger if exists finance_customer_invoices_storefront_charge on public.finance_customer_invoices;
create trigger finance_customer_invoices_storefront_charge before insert on public.finance_customer_invoices
  for each row execute function public.guard_storefront_charge_invoice();
revoke all on function public.guard_storefront_charge_invoice() from public, authenticated;
-- existing storefront invoices without a due date
update public.finance_customer_invoices i set due_date = i.invoice_date + public.payment_terms_days(c.payment_terms)
  from public.finance_customers c where c.id = i.customer_id and i.due_date is null and coalesce(i.notes, '') like 'Storefront sale%';

-- ------------------------------------------------------------------ SF-28 --
-- Businesses the caller's dashboard covers: the Super Admin's "Acting as"
-- business (or every active business when none), anyone else their own.
create or replace function public.dashboard_scope()
returns setof uuid language sql stable security definer set search_path = public as $$
  select b.id from public.businesses b
   where b.is_active and exists (select 1 from public.users u where u.id = auth.uid() and u.is_active)
     and case when public.is_super_admin() then (public.super_admin_view_business() is null or b.id = public.super_admin_view_business())
              else b.id = public.current_business_id() end;
$$;

-- Layer 1: today's counter sales, straight from the Storefront (preliminary)
create or replace function public.dashboard_today()
returns table(business_id uuid, business_name text, sales_count int, sales_total numeric, returns_total numeric, net_sales numeric, collected numeric, as_of timestamptz)
language sql stable security definer set search_path = public as $$
  with d as (select (now() at time zone 'Asia/Manila')::date as today)
  select b.id, coalesce(b.trade_name, b.legal_name),
    (select count(*)::int from public.storefront_sales s, d where s.business_id = b.id and s.status = 'completed' and s.sale_date = d.today),
    coalesce((select sum(total) from public.storefront_sales s, d where s.business_id = b.id and s.status = 'completed' and s.sale_date = d.today), 0),
    coalesce((select sum(total) from public.storefront_returns r, d where r.business_id = b.id and r.return_date = d.today), 0),
    coalesce((select sum(total) from public.storefront_sales s, d where s.business_id = b.id and s.status = 'completed' and s.sale_date = d.today), 0)
      - coalesce((select sum(total) from public.storefront_returns r, d where r.business_id = b.id and r.return_date = d.today), 0),
    coalesce((select sum(case when kind = 'refund' then -amount else amount end) from public.storefront_payments p, d
               where p.business_id = b.id and (p.received_at at time zone 'Asia/Manila')::date = d.today), 0),
    now()
  from public.businesses b where b.id in (select public.dashboard_scope())
  order by 2;
$$;

-- Layers 2–3: Finance-approved (posted) figures for a period. AR collections,
-- receivables and posted cash / bank balances only for admins and Finance;
-- commission is the store's total for them and the caller's own for staff.
create or replace function public.dashboard_period(p_from date, p_to date)
returns table(business_id uuid, business_name text, sales numeric, expenses numeric, bottomline numeric, commission numeric,
              collections numeric, receivables numeric, cash_bank numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_fin boolean := public.is_super_admin() or public.is_business_admin() or public.has_section_access('finance')
                         or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'finance');
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Invalid period.'; end if;
  return query
  select b.id, coalesce(b.trade_name, b.legal_name),
    coalesce(l.rev, 0), coalesce(l.exp, 0), coalesce(l.rev, 0) - coalesce(l.exp, 0),
    coalesce((select sum(sc.commission_amount) from public.sales_commissions sc where sc.business_id = b.id and sc.status in ('approved','paid')
               and (v_fin or sc.user_id = auth.uid())          -- staff see their own commission
               and coalesce(sc.approved_at, sc.created_at)::date between p_from and p_to), 0),
    case when v_fin then coalesce((select sum(r.amount) from public.finance_customer_receipts r where r.business_id = b.id and r.status = 'posted'
               and r.receipt_date between p_from and p_to), 0) end,
    case when v_fin then coalesce((select sum(i.balance_due) from public.finance_customer_invoices i where i.business_id = b.id
               and i.status in ('approved','partially_paid') and i.balance_due > 0), 0) end,
    case when v_fin then coalesce((select sum(a.current_balance) from public.finance_bank_accounts a where a.business_id = b.id and a.status = 'active'), 0) end
  from public.businesses b
  left join lateral (
    select sum(case when coa.account_type = 'revenue' then jl.credit - jl.debit else 0 end) as rev,
           sum(case when coa.account_type = 'expense' then jl.debit - jl.credit else 0 end) as exp
      from public.finance_journal_entries je join public.finance_journal_lines jl on jl.journal_entry_id = je.id
      join public.finance_chart_of_accounts coa on coa.id = jl.account_id
     where je.business_id = b.id and je.status = 'posted' and je.entry_date between p_from and p_to) l on true
  where b.id in (select public.dashboard_scope())
  order by 2;
end $$;

grant execute on function public.dashboard_today(), public.dashboard_period(date, date), public.dashboard_scope() to authenticated;
