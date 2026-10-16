'use client';
// Build 127 — Sales Manager: log a payment promise, and share a statement of account as an image
// (drawn on the phone; nothing is published — the phone's own share menu, or a download on a PC).
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { logPromiseAction } from './actions';

export type StatementData = {
  store: { name: string; header: string; text: string; logo: string | null };
  client: { name: string; contact?: string | null };
  invoices: { number: string; date: string; due: string | null; total: number; balance: number }[];
  owed: number; overdue: number; preparedBy: string;
};

const peso2 = (n: number) => `PHP ${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (s: string | null) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—');

async function loadImg(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { mode: 'cors' }); if (!r.ok) return null;
    const src = URL.createObjectURL(await r.blob());
    return await new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
  } catch { return null; }
}

async function drawStatement(s: StatementData): Promise<Blob> {
  const W = 1080, rowH = 64, top = 360, rows = Math.max(1, s.invoices.length);
  const H = top + 90 + rows * rowH + 260;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const F = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.fillStyle = s.store.header || '#0f172a'; x.fillRect(0, 0, W, 200);
  const logo = await loadImg(s.store.logo);
  let tx = 60;
  if (logo) { x.fillStyle = '#ffffff'; x.fillRect(60, 50, 100, 100); x.drawImage(logo, 65, 55, 90, 90); tx = 190; }
  x.fillStyle = s.store.text || '#ffffff'; x.font = `800 46px ${F}`; x.fillText(s.store.name.toUpperCase(), tx, 108);
  x.font = `500 28px ${F}`; x.fillText('Statement of account', tx, 152);
  x.fillStyle = '#0f172a'; x.font = `800 40px ${F}`; x.fillText(s.client.name, 60, 270);
  x.fillStyle = '#475569'; x.font = `400 26px ${F}`;
  x.fillText(`As of ${new Date().toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'long', year: 'numeric' })}${s.client.contact ? ` · Attn: ${s.client.contact}` : ''}`, 60, 314);
  const cols = [60, 330, 560, 790];
  x.fillStyle = '#f1f5f9'; x.fillRect(40, top, W - 80, 64);
  x.fillStyle = '#334155'; x.font = `700 24px ${F}`;
  ['Invoice', 'Date', 'Due', 'Balance'].forEach((h, i) => { if (i === 3) { x.textAlign = 'right'; x.fillText(h, W - 60, top + 42); x.textAlign = 'left'; } else x.fillText(h, cols[i], top + 42); });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  s.invoices.forEach((inv, i) => {
    const y = top + 64 + i * rowH;
    x.strokeStyle = '#e2e8f0'; x.beginPath(); x.moveTo(40, y + rowH); x.lineTo(W - 40, y + rowH); x.stroke();
    const late = inv.due && inv.due < today;
    x.fillStyle = '#0f172a'; x.font = `600 26px ${F}`; x.fillText(inv.number, cols[0], y + 42);
    x.font = `400 26px ${F}`; x.fillStyle = '#334155'; x.fillText(d(inv.date), cols[1], y + 42);
    x.fillStyle = late ? '#b91c1c' : '#334155'; x.fillText(d(inv.due) + (late ? ' (overdue)' : ''), cols[2], y + 42);
    x.fillStyle = '#0f172a'; x.font = `700 26px ${F}`; x.textAlign = 'right'; x.fillText(peso2(inv.balance), W - 60, y + 42); x.textAlign = 'left';
  });
  if (!s.invoices.length) { x.fillStyle = '#475569'; x.font = `400 26px ${F}`; x.fillText('No open invoices.', 60, top + 106); }
  const by = top + 64 + rows * rowH + 60;
  x.fillStyle = '#0f172a'; x.font = `800 34px ${F}`; x.fillText('Total balance', 60, by); x.textAlign = 'right'; x.fillText(peso2(s.owed), W - 60, by); x.textAlign = 'left';
  if (s.overdue > 0) { x.fillStyle = '#b91c1c'; x.font = `700 28px ${F}`; x.fillText('Overdue', 60, by + 48); x.textAlign = 'right'; x.fillText(peso2(s.overdue), W - 60, by + 48); x.textAlign = 'left'; }
  x.fillStyle = '#64748b'; x.font = `400 22px ${F}`;
  x.fillText(`Prepared by ${s.preparedBy}. Please disregard if payment has been made. Thank you.`, 60, H - 50);
  return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not draw the statement.'))), 'image/png'));
}

export function ShareStatementButton({ data, className = '' }: { data: StatementData; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function share() {
    setBusy(true); setErr('');
    try {
      const blob = await drawStatement(data);
      const file = new File([blob], `Statement - ${data.client.name}.png`, { type: 'image/png' });
      const nav: any = navigator;
      if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: `Statement of account — ${data.client.name}` });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); }
    } catch (e: any) { if (e?.name !== 'AbortError') setErr(errorText(e)); }
    finally { setBusy(false); }
  }
  return (
    <>
      <button type="button" onClick={share} disabled={busy} className={className || 'min-h-[44px] rounded-xl border text-sm font-bold'}>{busy ? 'Drawing…' : 'Send statement'}</button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </>
  );
}

export function PromiseButton({ customerId, suggested, className = '' }: { customerId: string; suggested?: number; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState(suggested ? String(Math.round(suggested * 100) / 100) : '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    setErr('');
    try { await logPromiseAction({ customer_id: customerId, date, amount: Number(amount), note }); setOpen(false); router.refresh(); }
    catch (e) { setErr(errorText(e)); }
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className || 'min-h-[44px] rounded-xl bg-[rgb(var(--btn))] text-sm font-bold text-[rgb(var(--on-btn))]'}>Log promise</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => setOpen(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); save(); }} className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:rounded-2xl">
            <h2 className="text-lg font-extrabold">Payment promise</h2>
            <label className="block text-sm font-semibold">Pays on<input className="input mt-1 w-full" type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="block text-sm font-semibold">Amount (₱)<input className="input mt-1 w-full" type="number" min="1" step="0.01" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
            <label className="block text-sm font-semibold">Note<input className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. by GCash, check to follow" /></label>
            {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] rounded-xl border font-bold">Cancel</button>
              <button disabled={pending} className="min-h-[48px] rounded-xl bg-[rgb(var(--btn))] font-bold text-[rgb(var(--on-btn))]">{pending ? 'Saving…' : 'Save promise'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
