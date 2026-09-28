// src/core/utils/statusBadge.tsx
import type { EntryStatus } from '@/core/auth/types';

type BadgeStatus = EntryStatus | 'active' | 'inactive';

const STYLES: Record<BadgeStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  prepared: 'bg-amber-100 text-amber-700',
  reviewed: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  posted: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-emerald-100 text-emerald-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-slate-100 text-slate-600',
};

const LABELS: Record<BadgeStatus, string> = {
  draft: 'Draft',
  prepared: 'Prepared',
  reviewed: 'Reviewed',
  approved: 'Approved',
  posted: 'Posted',
  paid: 'Paid',
  active: 'Active',
  inactive: 'Inactive',
};

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
