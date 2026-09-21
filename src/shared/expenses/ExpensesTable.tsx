// src/shared/expenses/ExpensesTable.tsx
'use client';

import { useTransition } from 'react';
import { StatusBadge } from '@/core/utils/statusBadge';
import type { ExpenseRow } from './service';
import type { SessionProfile } from '@/core/auth/types';
import { hasWorkflowRole } from '@/core/auth/types';
import { submitForReviewAction, markReviewedAction, markApprovedAction } from './actions';

export function ExpensesTable({ rows, profile }: { rows: ExpenseRow[]; profile: SessionProfile }) {
  const [isPending, startTransition] = useTransition();

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left border-b border-slate-200 text-slate-500">
          <th className="py-2 pr-4">Description</th>
          <th className="py-2 pr-4">Amount</th>
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
            (row.status === 'draft');

          return (
            <tr key={row.id} className="border-b border-slate-100">
              <td className="py-2 pr-4">{row.description}</td>
              <td className="py-2 pr-4">{row.amount.toLocaleString(undefined, { style: 'currency', currency: 'PHP' })}</td>
              <td className="py-2 pr-4"><StatusBadge status={row.status} /></td>
              <td className="py-2 pr-4 space-x-2">
                {canSubmit && (
                  <button
                    disabled={isPending}
                    onClick={() => startTransition(() => submitForReviewAction(row.id))}
                    className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {isPending ? 'Submitting…' : 'Submit for review'}
                  </button>
                )}
                {canReview && (
                  <button
                    disabled={isPending}
                    onClick={() => startTransition(() => markReviewedAction(row.id))}
                    className="text-xs font-semibold text-blue-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {isPending ? 'Saving…' : 'Mark reviewed'}
                  </button>
                )}
                {canApprove && (
                  <button
                    disabled={isPending}
                    onClick={() => startTransition(() => markApprovedAction(row.id))}
                    className="text-xs font-semibold text-green-600 hover:underline disabled:opacity-50 disabled:no-underline"
                  >
                    {isPending ? 'Saving…' : 'Approve'}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="py-6 text-center text-slate-400">
              No entries for this month.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
