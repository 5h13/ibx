-- Consolidated catalog controls: system numbering, lifecycle protection, and search indexes.
create sequence if not exists public.finance_procurement_item_code_seq;

-- Existing item codes remain unchanged. Keep the sequence ahead of all
-- existing ITM-numbers. (A fresh/empty table has no ITM- rows yet, so guard
-- against setval(seq, 0, true) — 0 is below the sequence's minvalue of 1 and
-- is only a legal setval() argument when is_called is false.)
do $$
declare mx bigint;
begin
  select coalesce(max((regexp_replace(item_code, '^ITM-', ''))::bigint), 0) into mx
    from public.finance_procurement_items where item_code ~ '^ITM-[0-9]+$';
  if mx = 0 then
    perform setval('public.finance_procurement_item_code_seq', 1, false);
  else
    perform setval('public.finance_procurement_item_code_seq', mx, true);
  end if;
end $$;

create or replace function public.generate_procurement_item_code()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.item_code is null or btrim(new.item_code) = '' then
      new.item_code := 'ITM-' || lpad(nextval('public.finance_procurement_item_code_seq')::text, 6, '0');
    end if;
  elsif tg_op = 'UPDATE' and new.item_code is distinct from old.item_code then
    raise exception 'Catalog item code is system-controlled and immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_generate_procurement_item_code on public.finance_procurement_items;
create trigger trg_generate_procurement_item_code
before insert or update of item_code on public.finance_procurement_items
for each row execute function public.generate_procurement_item_code();

create index if not exists idx_procurement_items_name_search
  on public.finance_procurement_items using gin (to_tsvector('simple', coalesce(item_name,'') || ' ' || coalesce(description,'') || ' ' || coalesce(category,'')));
create index if not exists idx_procurement_items_category_active
  on public.finance_procurement_items(active, category, item_name);

create or replace function public.guard_procurement_item_deactivation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Catalog items cannot be deleted; deactivate them instead.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_procurement_item_deactivation on public.finance_procurement_items;
create trigger trg_guard_procurement_item_deactivation
before delete on public.finance_procurement_items
for each row execute function public.guard_procurement_item_deactivation();
