'use client';
import { errorText } from '@/core/errors/appError';

// Build 57 — "Switch role" dropdown in the header, for a real Super Admin or
// Business Admin. Several roles may be ticked to audit a combined user. The
// Super Admin also picks the business; a Business Admin always audits its
// own business. The switch is real: the account holds the chosen role until
// "Return to my role" (see RoleAuditBanner) or the time limit.

import { useEffect, useRef, useState, useTransition } from 'react';
import { ROLE_PRESETS } from '@/core/auth/roleAuditPresets';
import { startRoleAuditAction } from '@/core/auth/roleAuditActions';

type Business = { id: string; code: string; legal_name: string; trade_name: string | null };

export function RoleAuditSwitcher({ isSuperAdmin, businesses, defaultBusinessId }: { isSuperAdmin: boolean; businesses: Business[]; defaultBusinessId: string | null }) {
  const [open, setOpen] = useState(false);
  const [roles, setRoles] = useState<string[]>([]);
  const [businessId, setBusinessId] = useState(defaultBusinessId ?? '');
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const presets = ROLE_PRESETS.filter((p) => isSuperAdmin || p.code !== 'BUSINESS_ADMIN');
  const toggle = (code: string) => setRoles((r) => (r.includes(code) ? r.filter((x) => x !== code) : [...r, code]));
  const go = () => {
    setError('');
    if (!roles.length) { setError('Tick at least one role.'); return; }
    if (isSuperAdmin && !businessId) { setError('Choose the business to audit.'); return; }
    start(async () => {
      try {
        await startRoleAuditAction(roles, isSuperAdmin ? businessId : null, minutes);
        window.location.href = '/dashboard';
      } catch (e: any) { setError(errorText(e) || 'Could not switch role.'); }
    });
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="rounded border border-amber-500/60 bg-slate-800 px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-slate-700">
        Switch role ▾
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-white p-3 text-left text-sm text-slate-800 shadow-xl">
          <div className="mb-2 font-semibold">Audit as role</div>
          <p className="mb-2 text-xs text-slate-500">Your account genuinely takes these roles until you return. Anything you do while switched is real.</p>
          {isSuperAdmin && (
            <label className="mb-2 block text-xs">Business
              <select className="input mt-1 w-full" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                <option value="">Select business</option>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.trade_name || b.legal_name}</option>)}
              </select>
            </label>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {presets.map((p) => (
              <label key={p.code} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
                <input type="checkbox" checked={roles.includes(p.code)} onChange={() => toggle(p.code)} />
                <span>{p.label}</span>
              </label>
            ))}
          </div>
          <label className="mt-2 block text-xs">Time limit
            <select className="input mt-1 w-full" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {[15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
          <button type="button" disabled={pending} onClick={go} className="button mt-3 w-full">{pending ? 'Switching…' : 'Start audit'}</button>
        </div>
      )}
    </div>
  );
}
