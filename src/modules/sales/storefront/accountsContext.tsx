'use client';

// Build 71 — the store's active receiving accounts (cash drawer, GCash / Maya
// numbers, card clearing, bank) for choosing which one received a payment.
// When a method has only one account the server uses it, so no choice shows.

import { createContext, useContext } from 'react';
import type { PaymentInput } from './actions';

export type StoreAccount = { id: string; method: PaymentInput['method']; name: string; number: string | null };
export const StoreAccountsContext = createContext<StoreAccount[]>([]);
export const useStoreAccounts = () => useContext(StoreAccountsContext);

export function AccountPicker({ method, value, onChange, refund = false }: { method: PaymentInput['method']; value?: string; onChange: (id: string) => void; refund?: boolean }) {
  const list = useStoreAccounts().filter((a) => a.method === method);
  if (list.length === 0 && method !== 'cash') {
    return <div className="col-span-12 text-xs text-amber-700">No {method === 'bank_transfer' ? 'bank' : method === 'card' ? 'card' : method === 'gcash' ? 'GCash' : method === 'check' ? 'checks-on-hand' : 'Maya'} account is set up for this store — a Business Admin adds it in Store settings.</div>;
  }
  if (list.length <= 1) return null;
  const label = method === 'gcash' ? 'GCash number' : method === 'maya' ? 'Maya number' : method === 'bank_transfer' ? 'Bank account' : 'Account';
  return (
    <label className="col-span-12 flex items-center gap-2 text-xs text-slate-600">{refund ? `${label} paying the refund` : `${label} that received it`} *
      <select className="input max-w-sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {list.map((a) => <option key={a.id} value={a.id}>{a.name}{a.number ? ` · ${a.number}` : ''}</option>)}
      </select>
    </label>
  );
}
