// src/core/utils/currentMonth.ts
import { createClient } from '@/core/auth/supabaseServer';

/** Returns the id of the current calendar month's row in public.months for a
 * given business, creating it if it doesn't exist yet.
 *
 * U002 fix: A001 made `months` business-scoped (unique(business_id, year,
 * month) instead of unique(year, month)), so "the current month" only makes
 * sense per business now. Pass the caller's effective business id --
 * `profile.user.business_id`, which getSessionProfile already resolves to
 * the Global Super Admin's selected acting business, or null if they
 * haven't picked one.
 *
 * businessId === null (a Super Admin with no acting business selected) has
 * no single row to resolve deterministically -- months.business_id is
 * NOT NULL, so there is no "global" row anymore, and there is nothing
 * meaningful to insert (see months_super_admin_all in schema.sql: writes to
 * `months` are super-admin-only, but even a super admin has to say *which*
 * business's period they're creating). In that case this returns the
 * oldest existing row for the given calendar month across all businesses
 * (deterministic, never creates a new mis-tagged row) so any read-only
 * caller still gets a real value; a caller that needs to *write* against a
 * specific business's period must resolve/require an acting business first. */
export async function getCurrentMonthId(businessId: string | null): Promise<string> {
  const supabase = createClient();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  if (!businessId) {
    const { data, error } = await supabase
      .from('months')
      .select('id')
      .eq('year', year)
      .eq('month', month)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No month period exists yet for this month. Select an acting business to create one.');
    return data.id;
  }

  const { data: existing, error: existingErr } = await supabase
    .from('months')
    .select('id')
    .eq('business_id', businessId)
    .eq('year', year)
    .eq('month', month)
    .maybeSingle();

  if (existingErr) throw existingErr;
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from('months')
    .insert({ business_id: businessId, year, month, label })
    .select('id')
    .single();

  if (error || !created) throw error ?? new Error('Could not create month row');
  return created.id;
}
