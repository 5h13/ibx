// Build 77 — DOC-03: Procurement's list of supplier price requests from Sales.
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { PriceRequests } from '@/modules/finance/price-requests/PriceRequests';

export const dynamic = 'force-dynamic';

export default async function PriceRequestsPage(props: { searchParams?: Promise<{ answered?: string }> }) {
  const searchParams = await props.searchParams;
  const profile = await requireSection('finance');
  const db = createClient();
  const showAnswered = searchParams?.answered === '1';
  const [{ data: requests, error: re }, { data: suppliers, error: se }] = await Promise.all([
    db.rpc('procurement_price_requests', { p_include_answered: showAnswered }),
    db.from('finance_suppliers').select('id,supplier_code,legal_name,payment_terms,active').eq('active', true).order('legal_name'),
  ]);
  const err = re || se;
  if (err) throw new Error(err.message);
  return (
    <AuthedShell profile={profile}>
      <PriceRequests requests={(requests as any[]) ?? []} suppliers={suppliers ?? []} showAnswered={showAnswered} />
    </AuthedShell>
  );
}
