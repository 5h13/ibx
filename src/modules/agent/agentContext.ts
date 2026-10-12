// Build 91 — server-side context for every agent page: the signed-in agent,
// his stores (store picker) and the store he is working in now (?b= or the
// last one he picked, kept in a cookie).
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import type { SessionProfile } from '@/core/auth/types';

export type AgentStore = { business_id: string; code: string; name: string };
export type AgentContext = { profile: SessionProfile; agentId: string | null; stores: AgentStore[]; store: AgentStore | null; error?: string };

export async function getAgentContext(b?: string | null): Promise<AgentContext> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  const db = createClient();
  const { data: agentId } = await db.rpc('current_agent_id');
  // Build 106: a staff login linked to an agent record may open the agent app too
  if (profile.user.role !== 'agent' && !agentId) redirect('/dashboard');
  if (!agentId) return { profile, agentId: null, stores: [], store: null, error: 'Your login is not linked to an agent record yet. Ask the Business Admin to link it (Settings → Users).' };
  const { data: stores, error } = await db.rpc('agent_stores');
  if (error) return { profile, agentId, stores: [], store: null, error: error.message };
  const list = (stores ?? []) as AgentStore[];
  const saved = (await cookies()).get('ibx_agent_store')?.value;
  const store = list.find((s) => s.business_id === b) ?? list.find((s) => s.business_id === saved) ?? list[0] ?? null;
  return { profile, agentId, stores: list, store };
}
