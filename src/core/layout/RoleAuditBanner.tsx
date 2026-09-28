'use client';

// Build 57 — always-visible banner while auditing a role, with the one
// control that must always work: "Return to my role" (end_role_audit works
// whatever role the account currently holds).

import { useEffect, useState, useTransition } from 'react';
import type { RoleAudit } from '@/core/auth/types';
import { presetLabel } from '@/core/auth/roleAuditPresets';
import { endRoleAuditAction } from '@/core/auth/roleAuditActions';

export function RoleAuditBanner({ audit, businessName }: { audit: RoleAudit; businessName: string }) {
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const minsLeft = Math.max(0, Math.ceil((new Date(audit.expiresAt).getTime() - now) / 60_000));
  const back = () => start(async () => { try { await endRoleAuditAction(); } finally { window.location.href = '/dashboard'; } });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-sm font-medium" style={{ color: '#0f172a' }} role="status">
      <span>
        Auditing as <b>{audit.roles.map(presetLabel).join(' + ')}</b> · {businessName} · {minsLeft > 0 ? `ends in ${minsLeft} min` : 'ending'} · actions are real
      </span>
      <button type="button" disabled={pending} onClick={back} className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60">
        {pending ? 'Returning…' : `Return to my role (${audit.originalRole === 'super_admin' ? 'Super Admin' : 'Business Admin'})`}
      </button>
    </div>
  );
}
