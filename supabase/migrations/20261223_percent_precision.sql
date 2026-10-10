-- Build 90a — percentages precise enough to land on a round price.
-- Markups were already stored with 8 decimals; the customer discount had only
-- 4, and the price review sent the markup back rounded to 4 decimals.
alter table public.finance_catalog_customer_discounts alter column discount_percent type numeric(14,8);

do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'price_review_set_item';
  if d is null then return; end if;
  n := replace(d, '''markup_percent'', round(v_new, 4)', '''markup_percent'', v_new');
  if n <> d then execute n; end if;
end $$;
