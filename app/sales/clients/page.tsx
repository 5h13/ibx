// Build 96 — Clients: the store's client list (like Suppliers), with each client's agent.
// Sales and Finance see it; the Sales approver and the Business Admin can move clients to
// another agent (both agents are notified in the agent app).
import { AuthedShell } from '@/core/layout/AuthedShell';
import { createClient } from '@/core/auth/supabaseServer';
import { isAdminTier } from '@/core/auth/types';
import { hasSectionAccess } from '@/core/auth/requireSection';
import { requireAnySection } from '@/shared/documents/access';
import { ClientsList } from '@/modules/sales/clients/ClientsList';

export const dynamic = 'force-dynamic';

export default async function ClientsPage(props: { searchParams?: Promise<{ agent?: string }> }) {
  const sp = (await props.searchParams) ?? {};
  const profile = await requireAnySection(['sales', 'finance']);
  const { data, error } = await createClient().rpc('sales_clients_list');
  if (error) throw new Error(error.message);
  const d: any = data ?? {};
  const finance = isAdminTier(profile) || hasSectionAccess(profile, 'finance');
  return (
    <AuthedShell profile={profile}>
      <ClientsList clients={d.clients ?? []} agents={d.agents ?? []} canMove={!!d.can_move} canFinance={finance} hasStore={!!d.business_id} initialAgent={sp.agent ?? ''} />
    </AuthedShell>
  );
}
