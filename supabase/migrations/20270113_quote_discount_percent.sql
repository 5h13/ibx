-- Build 112 — UIA-16: quotation discount by amount or by percentage (whole quotation).
--
-- discount_percent null  = the discount is a peso amount (discount_amount as entered).
-- discount_percent set   = discount_amount is always round(subtotal × % / 100, 2), so it
--                          follows the subtotal (supplier price received, revisions).
-- Checks on every save: no negative discount, % between 0 and 100, and the discount may not
-- be more than the lines total once the quotation has lines.
-- A revision keeps the percent of the quotation it revises (same pattern as VAT, SF-03d).
-- Runs before sales_quotations_vat (trigger names sort), so VAT is computed on the final discount.

alter table public.sales_quotations
  add column if not exists discount_percent numeric(5,2)
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100));

create or replace function public.guard_quotation_discount()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.revised_from is not null and new.discount_percent is null then
    select discount_percent into new.discount_percent from public.sales_quotations where id = new.revised_from;
  end if;
  if new.discount_percent is not null and (new.discount_percent < 0 or new.discount_percent > 100) then
    raise exception 'A percentage discount must be between 0%% and 100%%.';
  end if;
  if new.discount_percent is not null then
    new.discount_amount := round(coalesce(new.subtotal, 0) * new.discount_percent / 100, 2);
  end if;
  new.discount_amount := round(coalesce(new.discount_amount, 0), 2);
  -- older rows are only checked when their discount or subtotal changes (a status change is never blocked)
  if tg_op = 'UPDATE' and new.discount_amount is not distinct from old.discount_amount
     and new.subtotal is not distinct from old.subtotal then
    return new;
  end if;
  if new.discount_amount < 0 then
    raise exception 'The discount cannot be negative.';
  end if;
  if coalesce(new.subtotal, 0) > 0 and new.discount_amount > new.subtotal then
    raise exception 'The discount (₱%) is more than the lines total (₱%).', new.discount_amount, new.subtotal;
  end if;
  return new;
end $$;

drop trigger if exists sales_quotations_discount on public.sales_quotations;
create trigger sales_quotations_discount before insert or update on public.sales_quotations
  for each row execute function public.guard_quotation_discount();

revoke all on function public.guard_quotation_discount() from public, authenticated;
