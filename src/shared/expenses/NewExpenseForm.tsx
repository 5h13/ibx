// src/shared/expenses/NewExpenseForm.tsx
'use client';

import { useRef, useTransition } from 'react';
import { createExpenseDraftAction } from './actions-create';
import type { SectionCode } from '@/core/auth/types';

export function NewExpenseForm({ sectionCode, monthId, costCenters = [], categories = [], suppliers = [], suggestions = [] }: { sectionCode: SectionCode; monthId: string; costCenters?: Array<{id:string;code:string;name:string}>; categories?: Array<{id:string;code:string;name:string}>; suppliers?: Array<{id:string;supplier_code:string;legal_name:string}>; suggestions?: string[] }) {
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
        <input name="description" list="expense-description-suggestions" required className="border rounded px-2 py-1 text-sm" />
        <datalist id="expense-description-suggestions">{suggestions.map((item) => <option key={item} value={item} />)}</datalist>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Amount</label>
        <input name="amount" type="number" step="0.01" required className="border rounded px-2 py-1 text-sm w-32" />
      </div>
      {costCenters.length > 0 && <div>
        <label className="block text-xs text-slate-500 mb-1">Cost center</label>
        <select name="cost_center_id" className="border rounded px-2 py-1 text-sm w-44">
          <option value="">Unassigned</option>{costCenters.map(c=><option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>}
      {categories.length > 0 && <div>
        <label className="block text-xs text-slate-500 mb-1">Category</label>
        <select name="category_id" className="border rounded px-2 py-1 text-sm w-44">
          <option value="">Uncategorised</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>}
      {suppliers.length > 0 && <div>
        <label className="block text-xs text-slate-500 mb-1">Vendor / supplier</label>
        <select name="supplier_id" className="border rounded px-2 py-1 text-sm w-44">
          <option value="">Not a listed supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}
        </select>
      </div>}
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
