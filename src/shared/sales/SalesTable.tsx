// src/shared/sales/SalesTable.tsx
'use client';

import { useTransition } from 'react';
import { StatusBadge } from '@/core/utils/statusBadge';
import type { SalesRow } from './service';
import type { SessionProfile } from '@/core/auth/types';
import { hasWorkflowRole } from '@/core/auth/types';
import { submitSalesForReviewAction, markSalesReviewedAction, markSalesApprovedAction } from './actions';

const peso = (n: number) => n.toLocaleString(undefined, { style: 'currency', currency: 'PHP' });

export function SalesTable({ rows, profile }: { rows: SalesRow[]; profile: SessionProfile }) {
  const [isPending, startTransition] = useTransition();

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b border-slate-200 text-slate-500">
          <th className="py-2 pr-4">Agent</th>
          <th className="py-2 pr-4">Gross Sales</th>
          <th className="py-2 pr-4">Net Sales</th>
          <th className="py-2 pr-4">Commission</th>
          <th className="py-2 pr-4">Status</th>
          <th className="py-2 pr-4">Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const canReview = hasWorkflowRole(profile, row.section_id, 'reviewer') && row.status === 'prepared';
          const canApprove = hasWorkflowRole(profile, row.section_id, 'approver') && row.status === 'reviewed';
          const canSubmit =
            hasWorkflowRole(profile, row.section_id, 'preparer') &&
            row.prepared_by === profile.user.id &&
            row.status === 'draft';

          return (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2 pr-4">{row.agent_name}</td>
              <td className="py-2 pr-4">{peso(row.gross_sales)}</td>
              <td className="py-2 pr-4">{peso(row.net_sales)}</td>
              <td className="py-2 pr-4">{row.commission_amount != null ? peso(row.commission_amount) : '—'}</td>
              <td className="py-2 pr-4"><StatusBadge status={row.status} /></td>
              <td className="py-2 pr-4 space-x-2">
                {canSubmit && (
                  <button disabled={isPending} onClick={() => startTransition(() => submitSalesForReviewAction(row.id))} className="text-xs font-semibold text-blue-600 hover:underline">
                    Submit for review
                  </button>
                )}
                {canReview && (
                  <button disabled={isPending} onClick={() => startTransition(() => markSalesReviewedAction(row.id))} className="text-xs font-semibold text-blue-600 hover:underline">
                    Mark reviewed
                  </button>
                )}
                {canApprove && (
                  <button disabled={isPending} onClick={() => startTransition(() => markSalesApprovedAction(row.id))} className="text-xs font-semibold text-green-600 hover:underline">
                    Approve
                  </button>
                )}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="py-6 text-center text-slate-400">No sales entries for this month.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
