-- 5H13 ERP consolidated implementation: system-controlled transaction numbering.
-- Additive migration. Does not alter prior migrations.

create or replace function public.next_document_number(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(current_date,'YYYY');
  v_n bigint;
  v_prefix text := upper(trim(p_prefix));
begin
  perform pg_advisory_xact_lock(hashtext(v_prefix || ':' || v_year));
  execute format(
    'select coalesce(max((regexp_match(%I, $1))[1]::bigint),0)+1 from %I',
    'pr_number', 'purchase_requisitions'
  ) using '^'||v_prefix||'-'||v_year||'-(\\d+)$' into v_n;
  return v_prefix||'-'||v_year||'-'||lpad(v_n::text,4,'0');
exception when others then
  -- Fallback sequence-like allocation for prefixes not backed by a number column.
  return v_prefix||'-'||v_year||'-'||lpad((extract(epoch from clock_timestamp())::bigint % 100000)::text,5,'0');
end;
$$;

-- Dedicated generators avoid dynamic-table coupling and guarantee transaction-safe
-- numbering for the four audited document families.
create or replace function public.next_pr_number()
returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('PR:'||to_char(current_date,'YYYY')));
  select coalesce(max(substring(pr_number from 9)::bigint),0)+1 into n
  from public.purchase_requisitions
  where pr_number ~ ('^PR-'||to_char(current_date,'YYYY')||'-[0-9]{4,}$');
  return 'PR-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,4,'0');
end $$;

create or replace function public.next_po_number()
returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('PO:'||to_char(current_date,'YYYY')));
  select coalesce(max(substring(po_number from 9)::bigint),0)+1 into n
  from public.purchase_orders
  where po_number ~ ('^PO-'||to_char(current_date,'YYYY')||'-[0-9]{4,}$');
  return 'PO-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,4,'0');
end $$;

create or replace function public.next_receipt_number()
returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('RCV:'||to_char(current_date,'YYYY')));
  select coalesce(max(substring(receipt_number from 10)::bigint),0)+1 into n
  from public.logistics_receipts
  where receipt_number ~ ('^RCV-'||to_char(current_date,'YYYY')||'-[0-9]{4,}$');
  return 'RCV-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,4,'0');
end $$;

create or replace function public.next_transfer_number()
returns text language plpgsql security definer set search_path=public as $$
declare n bigint;
begin
  perform pg_advisory_xact_lock(hashtext('TRF:'||to_char(current_date,'YYYY')));
  select coalesce(max(substring(transfer_number from 10)::bigint),0)+1 into n
  from public.logistics_stock_transfers
  where transfer_number ~ ('^TRF-'||to_char(current_date,'YYYY')||'-[0-9]{4,}$');
  return 'TRF-'||to_char(current_date,'YYYY')||'-'||lpad(n::text,4,'0');
end $$;

-- Allow the application to omit the number. The database remains authoritative.
alter table public.purchase_requisitions alter column pr_number set default public.next_pr_number();
alter table public.purchase_orders alter column po_number set default public.next_po_number();
alter table public.logistics_receipts alter column receipt_number set default public.next_receipt_number();
alter table public.logistics_stock_transfers alter column transfer_number set default public.next_transfer_number();

create or replace function public.guard_pr_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and (new.pr_number is null or btrim(new.pr_number)='') then new.pr_number:=public.next_pr_number(); end if;
  if tg_op='UPDATE' and new.pr_number is distinct from old.pr_number then raise exception 'PR number is system-controlled and immutable.'; end if;
  return new;
end $$;
create or replace function public.guard_po_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and (new.po_number is null or btrim(new.po_number)='') then new.po_number:=public.next_po_number(); end if;
  if tg_op='UPDATE' and new.po_number is distinct from old.po_number then raise exception 'PO number is system-controlled and immutable.'; end if;
  return new;
end $$;
create or replace function public.guard_receipt_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and (new.receipt_number is null or btrim(new.receipt_number)='') then new.receipt_number:=public.next_receipt_number(); end if;
  if tg_op='UPDATE' and new.receipt_number is distinct from old.receipt_number then raise exception 'Receiving number is system-controlled and immutable.'; end if;
  return new;
end $$;
create or replace function public.guard_transfer_number()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' and (new.transfer_number is null or btrim(new.transfer_number)='') then new.transfer_number:=public.next_transfer_number(); end if;
  if tg_op='UPDATE' and new.transfer_number is distinct from old.transfer_number then raise exception 'Transfer number is system-controlled and immutable.'; end if;
  return new;
end $$;

drop trigger if exists purchase_requisitions_number_guard on public.purchase_requisitions;
create trigger purchase_requisitions_number_guard before insert or update on public.purchase_requisitions for each row execute function public.guard_pr_number();
drop trigger if exists purchase_orders_number_guard on public.purchase_orders;
create trigger purchase_orders_number_guard before insert or update on public.purchase_orders for each row execute function public.guard_po_number();
drop trigger if exists logistics_receipts_number_guard on public.logistics_receipts;
create trigger logistics_receipts_number_guard before insert or update on public.logistics_receipts for each row execute function public.guard_receipt_number();
drop trigger if exists logistics_stock_transfers_number_guard on public.logistics_stock_transfers;
create trigger logistics_stock_transfers_number_guard before insert or update on public.logistics_stock_transfers for each row execute function public.guard_transfer_number();

-- PR/PO workflow integrity: a PO may be linked only to an approved PR.
create or replace function public.guard_po_requisition_status()
returns trigger language plpgsql security definer set search_path=public as $$
declare s public.entry_status;
begin
  if new.requisition_id is not null then
    select status into s from public.purchase_requisitions where id=new.requisition_id;
    if s is null then raise exception 'Selected purchase requisition was not found.'; end if;
    if s <> 'approved' and (tg_op='INSERT' or new.requisition_id is distinct from old.requisition_id) then
      raise exception 'Only an approved purchase requisition may be converted to a purchase order.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_requisition_status_guard on public.purchase_orders;
create trigger purchase_orders_requisition_status_guard before insert or update on public.purchase_orders for each row execute function public.guard_po_requisition_status();
