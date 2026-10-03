'use client';
import { Form } from '@/core/ui/Form';
// Build 72 (U065) — choose a password (invitation, reset link, forced change, or My Account).
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { setOwnPasswordAction } from './passwordActions';

export function SetPasswordForm({ submitLabel = 'Save password', onDone }: { submitLabel?: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <Form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setError(''); start(async () => { try { await setOwnPasswordAction({ password, confirm }); onDone(); } catch (x) { setError(errorText(x)); } }); }}>
      <div>
        <label className="block text-xs text-slate-500 mb-1">New password</label>
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full border rounded px-3 py-2 text-sm" />
        <p className="mt-1 text-xs text-slate-400">At least 8 characters, with letters and a number.</p>
      </div>
      <div>
        <label className="block text-xs text-slate-500 mb-1">Repeat the new password</label>
        <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="w-full border rounded px-3 py-2 text-sm" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="w-full bg-slate-900 text-white text-sm font-semibold py-2 rounded hover:bg-slate-700 disabled:opacity-60">{pending ? 'Saving…' : submitLabel}</button>
    </Form>
  );
}
