// src/core/utils/statusBadge.tsx
import type { EntryStatus } from '@/core/auth/types';

const STYLES: Record<EntryStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  prepared: 'bg-amber-100 text-amber-700',
  reviewed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
};

const LABELS: Record<EntryStatus, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

export function StatusBadge({ status }: { status: EntryStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
