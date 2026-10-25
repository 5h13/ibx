// Build 139 — Sales → Shop Inbox (office app): the online shop's questions and requests for quotation, for the
// store's Business Admin, Sales Manager and sales staff. The same Inbox is in the Sales Manager app.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier, hasSectionAccess } from '@/core/auth/types';
import { InboxList } from '@/modules/shop/InboxList';
import { loadInbox } from '@/modules/shop/inboxData';

export const dynamic = 'force-dynamic';

export default async function SalesShopInbox(props: { searchParams?: Promise<{ show?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile) && !hasSectionAccess(profile, 'sales')) redirect('/dashboard');
  const b = profile.user.business_id;
  const data = b ? await loadInbox(b, sp.show) : null;
  const tab = (k: string, label: string) => (
    <Link href={`/sales/shop-inbox${k === 'open' ? '' : `?show=${k}`}`} aria-current={data?.show === k ? 'page' : undefined}
      className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${data?.show === k ? 'border-slate-800 bg-slate-800 text-white' : 'bg-white'}`}>{label}</Link>
  );
  return (
    <AuthedShell profile={profile}>
      <div className="max-w-5xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Shop Inbox</h2>
          <p className="text-sm text-slate-600">Questions and requests for quotation that buyers sent from this store&apos;s online shop. Reply by their chosen way, then mark the answer — they see it on their request page.</p>
        </div>
        {!b && <p className="rounded border bg-white p-4 text-sm text-slate-600">Choose a store in &quot;Acting as&quot; first.</p>}
        {data && (
          <>
            <nav className="flex gap-2" aria-label="Show">{tab('open', 'To answer')}{tab('done', 'Answered')}{tab('all', 'All')}</nav>
            <InboxList list={data.list} storeName={data.storeName} shop={data.shop} />
          </>
        )}
      </div>
    </AuthedShell>
  );
}
