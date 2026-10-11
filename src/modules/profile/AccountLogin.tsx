'use client';
// Build 104 — My Profile → "Sign-in and name": username (to sign in), nickname (shown on screens), email.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { updateMyLoginAction, updateMyEmailAction } from './accountActions';

export function AccountLogin({ username, nickname, fullName, email }: { username: string; nickname: string | null; fullName: string | null; email: string }) {
  const router = useRouter();
  const [u, setU] = useState(username);
  const [n, setN] = useState(nickname ?? '');
  const [e, setE] = useState(email);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>, ok: string) => start(async () => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); router.refresh(); } catch (err) { setMsg({ ok: false, text: errorText(err) }); }
  });
  return (
    <section className="mb-5 rounded-xl border bg-white p-5">
      <h2 className="font-semibold">Sign-in and name</h2>
      <p className="text-xs text-slate-500">Sign in with your username (or your email, once you have added one). Your nickname is the name people see on screens; documents keep your full name{fullName ? ` (${fullName})` : ''}.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-sm"><span className="text-slate-600">Username</span>
          <input className="mt-1 w-full rounded border p-2" value={u} onChange={(x) => setU(x.target.value)} autoCapitalize="none" spellCheck={false} />
          <span className="text-xs text-slate-400">Letters, numbers, dot, dash, underscore; 3–30 characters.</span></label>
        <label className="block text-sm"><span className="text-slate-600">Nickname (shown on screens)</span>
          <input className="mt-1 w-full rounded border p-2" value={n} placeholder="e.g. Fred or Fred Santiago" onChange={(x) => setN(x.target.value)} />
          <span className="text-xs text-slate-400">Leave blank to show your full name.</span></label>
      </div>
      <button className="button mt-3" disabled={pending || (u === username && n === (nickname ?? ''))} onClick={() => run(() => updateMyLoginAction(u, n), 'Username and nickname saved.')}>Save username and nickname</button>
      <div className="mt-5 border-t pt-4">
        <label className="block text-sm"><span className="text-slate-600">Email</span>
          <input className="mt-1 w-full rounded border p-2 md:w-1/2" type="email" value={e} placeholder="No email yet — add one to receive password-reset emails" onChange={(x) => setE(x.target.value)} /></label>
        <p className="mt-1 text-xs text-slate-500">{email ? 'You can sign in with this email or your username.' : 'Without an email, ask your Business Admin if you forget your password.'}</p>
        <button className="button-secondary mt-2" disabled={pending || !e.trim() || e.trim().toLowerCase() === email} onClick={() => run(() => updateMyEmailAction(e), 'Email saved. You can now also sign in with it.')}>{email ? 'Change email' : 'Add email'}</button>
      </div>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    </section>
  );
}
