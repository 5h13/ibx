'use server';
// Build 78 — quick price review (CAT-36). Every write goes through a SECURITY
// DEFINER function (migration 20261210) that checks the role (Sales approver,
// Finance, Business Admin, Super Admin acting as a store), keeps the change to
// the user's store and logs it.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

async function signedIn() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  return p;
}
const refresh = () => { revalidatePath('/sales/price-review'); revalidatePath('/catalog'); };

export async function setItemPriceAction(itemId: string, input: { markup?: number | null; store_price?: number | null }) {
  await signedIn();
  const { data, error } = await createClient().rpc('price_review_set_item', { p_item: itemId, p_markup: input.markup ?? null, p_store_price: input.store_price ?? null });
  if (error) throw appError(error.message);
  refresh();
  return data as { markup_percent: number; store_price: number; old_store_price: number };
}

export async function setCategoryAddonAction(categoryId: string, addon: number) {
  await signedIn();
  const { data, error } = await createClient().rpc('price_review_set_addon', { p_category: categoryId, p_addon: addon });
  if (error) throw appError(error.message);
  refresh();
  return data as { category: string; addon_percent: number; old_addon_percent: number; items_affected: number };
}

// Build 79 (SF-31): every purchase price of the item in this store, by supplier then date.
export async function itemPurchasesAction(itemId: string) {
  await signedIn();
  const { data, error } = await createClient().rpc('price_review_purchases', { p_item: itemId });
  if (error) throw appError(error.message);
  return (data ?? []) as { supplier: string | null; purchase_date: string; unit_cost: number; quantity: number; source: string; reference: string | null; lot_code: string | null; on_hand: number | null }[];
}
