// src/shared/sales/NewSalesForm.tsx
'use client';

import { useRef, useTransition } from 'react';
import { createSalesDraftAction } from './actions';

export function NewSalesForm({ monthId }: { monthId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          await createSalesDraftAction(monthId, formData);
          formRef.current?.reset();
        })
      }
      className="flex flex-wrap gap-2 items-end mb-4"
    >
      {[
        ['agent_name', 'Agent', 'text'],
        ['gross_sales', 'Gross Sales', 'number'],
        ['cash_collected', 'Cash Collected', 'number'],
        ['gcash_collected', 'G-Cash', 'number'],
        ['expenses', 'Expenses', 'number'],
        ['commission_rate', 'Comm. Rate (0-1)', 'number'],
      ].map(([name, label, type]) => (
        <div key={name}>
          <label className="block text-xs text-slate-500 mb-1">{label}</label>
          <input
            name={name}
            type={type}
            step={type === 'number' ? '0.01' : undefined}
            required
            className="border rounded px-2 py-1 text-sm w-32"
          />
        </div>
      ))}
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
