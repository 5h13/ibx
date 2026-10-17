// Build 133 — Sales Manager app: the store's "Needs attention" settings.
import { ManagerShell, managerProfile } from '@/modules/manager/ManagerShell';
import { loadAttention } from '@/modules/manager/actions';
import { AttentionSettings } from '@/modules/manager/AttentionSettings';

export const dynamic = 'force-dynamic';

export default async function ManagerSettings() {
  const profile = await managerProfile();
  const a: any = profile.user.business_id ? await loadAttention() : null;
  return (
    <ManagerShell profile={profile} title="Needs attention · settings" back="/manager" attention={a ? Number(a.counts?.red ?? 0) + Number(a.counts?.amber ?? 0) : 0}>
      {a && <AttentionSettings settings={a.settings} />}
    </ManagerShell>
  );
}
