// src/shared/expenses/NewExpenseForm.tsx
'use client';

import { useRef, useTransition } from 'react';
import { createExpenseDraftAction } from './actions-create';
import type { SectionCode } from '@/core/auth/types';

export function NewExpenseForm({ sectionCode, monthId }: { sectionCode: SectionCode; monthId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          await createExpenseDraftAction(sectionCode, monthId, formData);
          formRef.current?.reset();
        })
      }
      className="flex flex-wrap gap-2 items-end mb-4"
    >
      <div>
        <label className="block text-xs text-slate-500 mb-1">Description</label>
        <input name="description" required className="border rounded px-2 py-1 text-sm" />
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Amount</label>
        <input name="amount" type="number" step="0.01" required className="border rounded px-2 py-1 text-sm w-32" />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="bg-slate-900 text-white text-sm font-semibold px-3 py-1.5 rounded hover:bg-slate-700"
      >
        Save draft
      </button>
    </form>
  );
}
