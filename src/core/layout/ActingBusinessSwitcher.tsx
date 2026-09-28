'use client';

import { useTransition } from 'react';
import { setActingBusinessAction } from '@/core/auth/actingBusinessActions';

type Business = { id: string; code: string; legal_name: string; trade_name: string | null };

export function ActingBusinessSwitcher({ businesses, actingBusinessId }: { businesses: Business[]; actingBusinessId: string | null }) {
  const [pending, startTransition] = useTransition();

  function change(businessId: string) {
    const fd = new FormData();
    fd.set('business_id', businessId);
    startTransition(async () => {
      await setActingBusinessAction(fd);
      window.location.reload();
    });
  }

  return (
    <label className="flex items-center gap-2 text-xs text-slate-300">
      <span className="uppercase tracking-wide text-slate-400">Acting as</span>
      <select
        disabled={pending}
        value={actingBusinessId ?? ''}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-slate-600 bg-slate-800 text-white text-xs px-2 py-1 disabled:opacity-50"
      >
        <option value="">5H13 (all businesses)</option>
        {businesses.map((b) => (
          <option key={b.id} value={b.id}>
            {b.trade_name || b.legal_name}
          </option>
        ))}
      </select>
    </label>
  );
}
