'use client';

// Build 79 — SF-30: one customer box. Shows the chosen customer (Walk-in by
// default when a walk-in id is given); typing part of a name, code or phone
// lists the matching customers under it; click one to choose it. Clearing the
// box goes back to Walk-in (or to no customer).

import { useEffect, useRef, useState } from 'react';

export type BoxCustomer = { id: string; customer_code: string; legal_name: string; phone: string | null };

export function CustomerBox({ customers, value, onChange, walkInId, placeholder = 'Type a customer name, code or phone' }: {
  customers: BoxCustomer[]; value: string; onChange: (id: string) => void; walkInId?: string; placeholder?: string;
}) {
  const label = (id: string) => (walkInId && id === walkInId ? 'Walk-in customer' : customers.find((c) => c.id === id)?.legal_name ?? '');
  const [text, setText] = useState(label(value));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setText(label(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) { setOpen(false); setText(label(value)); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  const q = text.trim().toLowerCase();
  const typing = q !== '' && q !== label(value).toLowerCase();
  const matches = customers.filter((c) => c.id !== walkInId && (!typing || `${c.legal_name} ${c.customer_code} ${c.phone ?? ''}`.toLowerCase().includes(q))).slice(0, 50);
  const choose = (id: string) => { onChange(id); setText(label(id)); setOpen(false); };
  return (
    <div ref={box} className="relative w-full max-w-md">
      <input className="input w-full" value={text} placeholder={placeholder} onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (!e.target.value.trim()) onChange(walkInId ?? ''); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches[0]) choose(matches[0].id); } if (e.key === 'Escape') { setOpen(false); setText(label(value)); } }} />
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border bg-white shadow-lg">
          {walkInId && <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100" onClick={() => choose(walkInId)}>Walk-in customer</button>}
          {matches.map((c) => (
            <button key={c.id} type="button" className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 ${c.id === value ? 'bg-slate-50 font-medium' : ''}`} onClick={() => choose(c.id)}>
              {c.legal_name}<span className="ml-2 text-xs text-slate-500">{c.customer_code}{c.phone ? ` · ${c.phone}` : ''}</span>
            </button>
          ))}
          {matches.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No customer matches “{text.trim()}”.</div>}
        </div>
      )}
    </div>
  );
}
