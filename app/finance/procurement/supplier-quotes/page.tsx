import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import SupplierQuoteLog from '@/modules/finance/procurement/SupplierQuoteLog';
import { canManageSupplierQuotes, canViewSupplierQuotes } from '@/modules/finance/procurement/supplierQuoteAccess';

// Build 56 — supplier quote log (DOC-14). Viewable by Procurement (Finance
// section), Finance and Sales; managed by Procurement only. Shared across
// businesses (the current cost it sets is shared). Session-scoped reads: RLS
// decides visibility.
export default async function SupplierQuotesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!canViewSupplierQuotes(profile)) redirect('/dashboard');
  const db = createClient();
  const [{ data: quotes, error: qe }, { data: suppliers, error: se }] = await Promise.all([
    db.from('finance_supplier_quote_log')
      .select('id,item_id,supplier_id,unit_price,validity,lead_time,created_at,updated_at,item:finance_procurement_items(id,item_code,item_name,unit,item_type,standard_cost,service_cost_basis,cost_updated_at,cost_source_quote_id),supplier:finance_suppliers(supplier_code,legal_name,payment_terms),business:businesses(code)')
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('finance_suppliers').select('id,supplier_code,legal_name,payment_terms').eq('active', true).order('legal_name'),
  ]);
  if (qe || se) throw new Error(qe?.message || se?.message || 'Unable to load supplier quotes.');
  return (
    <AuthedShell profile={profile}>
      <SupplierQuoteLog quotes={(quotes ?? []) as any} suppliers={(suppliers ?? []) as any} canManage={canManageSupplierQuotes(profile)} />
    </AuthedShell>
  );
}
