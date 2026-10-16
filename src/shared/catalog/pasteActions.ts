'use server';
// Build 119 — Paste list: match pasted lines to the catalog; remember the picks per store.
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { appError } from '@/core/errors/appError';

export type PasteCandidate = { item_id: string; item_code: string; item_name: string; unit: string | null; brand: string | null; score: number; matched: string[]; missed: string[]; remembered: boolean };
export type PasteMatch = { line: number; text: string; words: string[]; candidates: PasteCandidate[] };

async function signedIn() {
  const p = await getSessionProfile();
  if (!p?.user.is_active) throw appError('Authentication required.');
  return p;
}
export async function pasteMatchAction(lines: string[], businessId?: string | null, onlyItems?: string[] | null) {
  await signedIn();
  const { data, error } = await createClient().rpc('catalog_paste_match', { p_lines: lines, p_business: businessId || null, p_items: onlyItems && onlyItems.length ? onlyItems : null });
  if (error) throw appError(error.message);
  return (data ?? []) as PasteMatch[];
}
export async function pasteRememberAction(businessId: string | null, pairs: { phrase: string; item_id: string }[]) {
  await signedIn();
  if (!pairs.length) return 0;
  const { data, error } = await createClient().rpc('catalog_paste_remember', { p_business: businessId || null, p_pairs: pairs });
  if (error) throw appError(error.message);
  return Number(data ?? 0);
}
