-- IBX Sales -> AR / Revenue Recognition + Monthly Sales / Commission integration

create table if not exists public.sales_revenue_recognitions (
  id uuid primary key default gen_random_uuid(),
  recognition_number text not null unique,
  sales_order_id uuid not null references public.sales_orders(id),
  delivery_order_id uuid references public.logistics_delivery_orders(id),
  customer_id uuid not null references public.finance_customers(id),
  ar_invoice_id uuid references public.finance_customer_invoices(id),
  journal_entry_id uuid references public.finance_journal_entries(id),
  recognition_date date not null default current_date,
  revenue_amount numeric(14,2) not null default 0 check (revenue_amount >= 0),
  status text not null default 'draft' check (status in ('draft','prepared','reviewed','approved','posted','cancelled')),
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sales_order_id)
);

create table if not exists public.sales_monthly_revenue_summary (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections(id),
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  fulfilled_orders integer not null default 0,
  gross_revenue numeric(14,2) not null default 0,
  ar_invoiced numeric(14,2) not null default 0,
  cash_collected numeric(14,2) not null default 0,
  commission_accrued numeric(14,2) not null default 0,
  commission_approved numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  unique(section_id, year, month)
);

alter table public.sales_revenue_recognitions enable row level security;
alter table public.sales_monthly_revenue_summary enable row level security;

create policy sales_revenue_recognition_access on public.sales_revenue_recognitions for all using (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
) with check (
  public.is_super_admin() or (select role from public.users where id=auth.uid())='sales' or public.in_section((select id from public.sections where code='sales'))
);
create policy sales_monthly_revenue_summary_access on public.sales_monthly_revenue_summary for select using (
  public.is_super_admin() or public.in_section(section_id)
);
create policy sales_monthly_revenue_summary_admin on public.sales_monthly_revenue_summary for all using (
  public.is_super_admin()
) with check (public.is_super_admin());

create index if not exists idx_sales_revenue_recognition_order on public.sales_revenue_recognitions(sales_order_id);
create index if not exists idx_sales_revenue_recognition_status on public.sales_revenue_recognitions(status, recognition_date);
create index if not exists idx_sales_monthly_revenue_summary_period on public.sales_monthly_revenue_summary(year, month);

create or replace function public.refresh_sales_monthly_revenue_summary(p_year integer, p_month integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_section uuid; v_start date; v_end date; v_orders integer; v_revenue numeric(14,2); v_ar numeric(14,2); v_cash numeric(14,2); v_comm numeric(14,2); v_comm_approved numeric(14,2);
begin
  select id into v_section from public.sections where code='sales' limit 1;
  if v_section is null then return; end if;
  v_start := make_date(p_year,p_month,1);
  v_end := (v_start + interval '1 month')::date;
  select count(*), coalesce(sum(total_amount),0) into v_orders,v_revenue
    from public.sales_orders where order_date >= v_start and order_date < v_end and status='fulfilled';
  select coalesce(sum(inv.total_amount),0), coalesce(sum(inv.amount_received),0) into v_ar,v_cash
    from public.sales_revenue_recognitions rr join public.finance_customer_invoices inv on inv.id=rr.ar_invoice_id
    where rr.recognition_date >= v_start and rr.recognition_date < v_end and inv.status <> 'voided';
  select coalesce(sum(commission_amount),0), coalesce(sum(commission_amount) filter(where status in ('approved','paid')),0) into v_comm,v_comm_approved
    from public.sales_commissions sc join public.sales_orders so on so.id=sc.sales_order_id
    where so.order_date >= v_start and so.order_date < v_end;
  insert into public.sales_monthly_revenue_summary(section_id,year,month,fulfilled_orders,gross_revenue,ar_invoiced,cash_collected,commission_accrued,commission_approved,updated_at)
  values(v_section,p_year,p_month,v_orders,v_revenue,v_ar,v_cash,v_comm,v_comm_approved,now())
  on conflict(section_id,year,month) do update set
    fulfilled_orders=excluded.fulfilled_orders,gross_revenue=excluded.gross_revenue,ar_invoiced=excluded.ar_invoiced,
    cash_collected=excluded.cash_collected,commission_accrued=excluded.commission_accrued,commission_approved=excluded.commission_approved,updated_at=now();
end; $$;

grant execute on function public.refresh_sales_monthly_revenue_summary(integer,integer) to authenticated;

create or replace function public.create_sales_revenue_draft(p_order_id uuid, p_delivery_id uuid, p_actor uuid, p_recognition_number text, p_invoice_number text)
returns uuid language plpgsql security definer set search_path=public as $$
declare o public.sales_orders%rowtype; c uuid; inv uuid; rr uuid; je uuid; revenue numeric(14,2); ar_account uuid; revenue_account uuid; section_id uuid; ddate date;
begin
  select * into o from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if o.status not in ('processing','fulfilled') then raise exception 'Sales order must be in processing or fulfilled status'; end if;
  select id into section_id from public.sections where code='sales' limit 1;
  select id into ar_account from public.finance_chart_of_accounts where account_code='1100' limit 1;
  select id into revenue_account from public.finance_chart_of_accounts where account_code='4000' limit 1;
  if ar_account is null or revenue_account is null then raise exception 'Required AR/revenue accounts are missing'; end if;
  revenue := o.total_amount;
  ddate := coalesce((select delivery_date from public.logistics_delivery_orders where id=p_delivery_id), o.order_date);
  if exists(select 1 from public.sales_revenue_recognitions where sales_order_id=o.id) then raise exception 'Revenue recognition already exists for this order'; end if;
  insert into public.finance_customer_invoices(invoice_number,customer_id,invoice_date,due_date,currency,subtotal,discount_amount,tax_amount,other_charges,status,created_by,notes)
  values(p_invoice_number,o.customer_id,ddate,ddate + 30,o.currency,o.subtotal,o.discount_amount,o.tax_amount,o.other_charges,'draft',p_actor,'Generated from sales order '||o.order_number)
  returning id into inv;
  insert into public.finance_customer_invoice_items(invoice_id,description,quantity,unit,unit_price,notes)
  select inv,description,quantity,unit,unit_price,notes from public.sales_order_items where order_id=o.id;
  insert into public.finance_journal_entries(journal_number,entry_date,description,source_module,source_record_id,section_id,status,total_debit,total_credit,created_by,notes)
  values('JE-SALES-'||replace(p_recognition_number,'REC-',''),ddate,'Revenue recognition - '||o.order_number,'sales_revenue',o.id,section_id,'draft',revenue,revenue,p_actor,'Draft accounting entry generated with AR invoice')
  returning id into je;
  insert into public.finance_journal_lines(journal_entry_id,account_id,line_description,debit,credit,department)
  values(je,ar_account,'Accounts receivable - '||o.order_number,revenue,0,'Sales'),(je,revenue_account,'Sales revenue - '||o.order_number,0,revenue,'Sales');
  insert into public.sales_revenue_recognitions(recognition_number,sales_order_id,delivery_order_id,customer_id,ar_invoice_id,journal_entry_id,recognition_date,revenue_amount,status,created_by)
  values(p_recognition_number,o.id,p_delivery_id,o.customer_id,inv,je,ddate,revenue,'draft',p_actor)
  returning id into rr;
  perform public.recalculate_finance_journal_totals(je);
  if p_delivery_id is not null then update public.sales_orders set status='fulfilled',fulfilled_at=coalesce(fulfilled_at,now()),updated_at=now() where id=o.id; end if;
  return rr;
end; $$;

grant execute on function public.create_sales_revenue_draft(uuid,uuid,uuid,text,text) to authenticated;
