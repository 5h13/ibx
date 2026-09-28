import { appError } from '@/core/errors/appError';
import { createClient } from '@/core/auth/supabaseServer';

export type IntegrationEventInput = {
  sourceModule: string;
  targetModule: string;
  eventType: string;
  sourceTable?: string;
  sourceRecordId?: string;
  status?: 'pending' | 'completed' | 'failed' | 'skipped';
  message?: string;
  payload?: Record<string, unknown>;
  actorId?: string;
};

/** Cross-module trace only. The source transaction remains authoritative. */
export async function recordIntegrationEvent(input: IntegrationEventInput) {
  const db = createClient();
  const { error } = await db.rpc('record_integration_event', {
    p_source_module: input.sourceModule,
    p_target_module: input.targetModule,
    p_event_type: input.eventType,
    p_source_table: input.sourceTable ?? null,
    p_source_record_id: input.sourceRecordId ?? null,
    p_status: input.status ?? 'completed',
    p_message: input.message ?? null,
    p_payload: input.payload ?? null,
    p_actor_id: input.actorId ?? null,
  });
  if (error) throw appError(error.message);
}
