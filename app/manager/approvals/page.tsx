// Build 127 — Sales Manager app: Approvals.
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadApprovals } from '@/modules/manager/actions';
import { ApprovalsList } from '@/modules/manager/ApprovalsList';

export const dynamic = 'force-dynamic';

export default async function ManagerApprovals(props: { searchParams?: Promise<{ kind?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await managerProfile();
  const items = profile.user.business_id ? await loadApprovals() : [];
  return (
    <ManagerShell profile={profile} title="Approvals" counts={items.length}>
      <ApprovalsList items={items} initial={sp.kind} />
    </ManagerShell>
  );
}
