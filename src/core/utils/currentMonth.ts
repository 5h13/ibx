// src/core/utils/currentMonth.ts
import { createClient } from '@/core/auth/supabaseServer';

/** Returns the id of the current calendar month's row in public.months,
 * creating it if it doesn't exist yet. */
export async function getCurrentMonthId(): Promise<string> {
  const supabase = createClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const { data: existing } = await supabase
    .from('months')
    .select('id')
    .eq('year', year)
    .eq('month', month)
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('months')
    .insert({ year, month, label })
    .select('id')
    .single();

  if (error || !created) throw error ?? new Error('Could not create month row');
  return created.id;
}
