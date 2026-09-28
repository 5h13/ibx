-- Consolidated release: finance expense lifecycle, period controls, accounting classification and audit trail.

-- Expense lifecycle is shared with existing entry_status users. These values are additive.
do $$ begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='entry_status' and e.enumlabel='posted') then
    alter type public.entry_status add value 'posted';
  end if;
  if not exists (select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='entry_status' and e.enumlabel='paid') then
    alter type public.entry_status add value 'paid';
  end if;
end $$;

alter table public.expenses
  add column if not exists accounting_classification text,
  add column if not exists document_reference text,
  add column if not exists posted_by uuid references public.users(id),
  add column if not exists posted_at timestamptz,
  add column if not exists paid_by uuid references public.users(id),
  add column if not exists paid_at timestamptz;

create index if not exists expenses_accounting_classification_idx
  on public.expenses(accounting_classification);
create index if not exists expenses_status_date_idx
  on public.expenses(status, expense_date desc);

-- Prevent edits/posting against closed accounting periods.
create or replace function public.guard_expense_period_and_transition()
returns trigger language plpgsql as $$
declare
  closed boolean;
  allowed boolean := false;
begin
  select is_closed into closed from public.months where id = new.month_id;
  if coalesce(closed,false) then
    if tg_op = 'INSERT' then
      raise exception 'The accounting period is closed.';
    end if;
    if new.status <> old.status or new.description is distinct from old.description
       or new.amount is distinct from old.amount or new.expense_date is distinct from old.expense_date
       or new.accounting_classification is distinct from old.accounting_classification
       or new.document_reference is distinct from old.document_reference then
      raise exception 'The accounting period is closed.';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    allowed := (old.status::text='draft' and new.status::text='prepared')
      or (old.status::text='prepared' and new.status::text in ('draft','reviewed'))
      or (old.status::text='reviewed' and new.status::text in ('draft','approved'))
      or (old.status::text='approved' and new.status::text='posted')
      or (old.status::text='posted' and new.status::text='paid');
    if not allowed then
      raise exception 'Invalid expense status transition: % -> %.', old.status, new.status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists expenses_period_transition_guard on public.expenses;
create trigger expenses_period_transition_guard
before insert or update on public.expenses
for each row execute function public.guard_expense_period_and_transition();

-- Authoritative audit history for every expense status transition and material edit.
create or replace function public.audit_expense_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(actor_id, entity_table, entity_id, action, to_status, detail)
    values (auth.uid(), 'expenses', new.id, 'created', new.status,
            jsonb_build_object('description',new.description,'amount',new.amount,'month_id',new.month_id));
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.audit_log(actor_id, entity_table, entity_id, action, from_status, to_status, detail)
      values (auth.uid(), 'expenses', new.id,
              case new.status::text when 'prepared' then 'submitted' when 'reviewed' then 'reviewed'
                   when 'approved' then 'approved' when 'posted' then 'posted' when 'paid' then 'paid'
                   when 'draft' then 'returned' else 'status_changed' end,
              old.status, new.status, jsonb_build_object('month_id',new.month_id));
    elsif new.description is distinct from old.description
       or new.amount is distinct from old.amount
       or new.expense_date is distinct from old.expense_date
       or new.accounting_classification is distinct from old.accounting_classification
       or new.document_reference is distinct from old.document_reference
       or new.notes is distinct from old.notes then
      insert into public.audit_log(actor_id, entity_table, entity_id, action, detail)
      values (auth.uid(), 'expenses', new.id, 'edited',
              jsonb_build_object('changed_at',now()));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists expenses_audit_change on public.expenses;
create trigger expenses_audit_change
after insert or update on public.expenses
for each row execute function public.audit_expense_change();

-- Only an authorized Finance workflow approver/Super Admin may post or mark paid.
drop policy if exists expenses_update_finance_post on public.expenses;
create policy expenses_update_finance_post on public.expenses
for update using (
  (public.is_super_admin() or public.has_workflow_role(section_id,'approver'))
  and status::text in ('approved','posted')
) with check (
  (public.is_super_admin() or public.has_workflow_role(section_id,'approver'))
);

-- Finance users need to see the authoritative audit trail for their expenses; existing
-- audit_log super-admin policy remains unchanged, so expose only through this controlled view.
create or replace view public.finance_expense_history as
select a.id, a.entity_id as expense_id, a.actor_id, a.action, a.from_status, a.to_status, a.detail, a.created_at
from public.audit_log a
where a.entity_table='expenses';
