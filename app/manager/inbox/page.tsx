// Build 139 — Sales Manager app: the online shop's Inbox (questions and requests for quotation from buyers).
import Link from 'next/link';
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { InboxList } from '@/modules/shop/InboxList';
import { loadInbox } from '@/modules/shop/inboxData';

export const dynamic = 'force-dynamic';

export default async function ManagerInbox(props: { searchParams?: Promise<{ show?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await managerProfile();
  const b = profile.user.business_id;
  const data = b ? await loadInbox(b, sp.show) : null;
  const tab = (k: string, label: string) => (
    <Link href={`/manager/inbox${k === 'open' ? '' : `?show=${k}`}`} aria-current={data?.show === k ? 'page' : undefined}
      className={`flex min-h-[40px] items-center rounded-full border px-4 text-sm font-semibold ${data?.show === k ? 'border-[rgb(var(--btn))] bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-white'}`}>{label}</Link>
  );
  return (
    <ManagerShell profile={profile} title="Shop Inbox">
      {data && (
        <>
          <p className="text-sm text-slate-600">Requests buyers sent from the online shop. Reply by their chosen way, then mark the answer — they see it on their request page.</p>
          <nav className="flex gap-2" aria-label="Show">{tab('open', 'To answer')}{tab('done', 'Answered')}{tab('all', 'All')}</nav>
          <InboxList list={data.list} storeName={data.storeName} shop={data.shop} />
        </>
      )}
    </ManagerShell>
  );
}
