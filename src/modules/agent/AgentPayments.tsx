'use client';
// Build 91 — agent payment reports: choose the client, enter what was paid on
// each open DR / invoice, how it was paid and (optionally) a photo of the
// deposit slip or check. The cashier confirms at the counter.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { shrink } from '@/modules/finance/procurement/CatalogPhotoUpload';
import { agentPhotoUrlAction, cancelPaymentAction, openInvoicesAction, reportPaymentAction, uploadAgentPhotoAction } from './agentActions';
import { Pill, manilaToday, peso } from './AgentHeader';
import type { AgentClient } from './AgentClients';

const METHODS = [['cash', 'Cash'], ['gcash', 'GCash'], ['maya', 'Maya'], ['bank_transfer', 'Bank transfer'], ['check', 'Check'], ['card', 'Card']] as const;
const r2 = (n: number) => Math.round(n * 100) / 100;
type Inv = Awaited<ReturnType<typeof openInvoicesAction>>[number];

function ReportForm({ clients, initialClient, onDone }: { clients: AgentClient[]; initialClient: string; onDone: (m: string) => void }) {
  const [clientId, setClientId] = useState(initialClient);
  const [invoices, setInvoices] = useState<Inv[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [f, setF] = useState({ method: 'cash', reference: '', paid_on: manilaToday(), check_bank: '', check_date: '', issuer: '', notes: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    setInvoices([]); setAmounts({}); setError('');
    if (clientId) openInvoicesAction(clientId).then(setInvoices).catch((e) => setError(errorText(e)));
  }, [clientId]);
  const left = (i: Inv) => r2(Number(i.balance_due) - Number(i.reported));
  const total = r2(Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0));
  // fill the oldest first (AR-02) from one amount
  const [spread, setSpread] = useState('');
  const fillOldest = () => {
    let rest = Number(spread) || 0; const next: Record<string, string> = {};
    for (const i of invoices) { const take = Math.min(rest, left(i)); if (take > 0) next[i.invoice_id] = String(r2(take)); rest = r2(rest - take); }
    setAmounts(next);
  };
  const submit = () => start(async () => {
    setError('');
    try {
      let photo_path: string | null = null;
      if (photo) { const fd = new FormData(); fd.set('file', photo.type.startsWith('image/') ? await shrink(photo) : photo); photo_path = await uploadAgentPhotoAction(fd); }
      await reportPaymentAction({ customer_id: clientId, ...f, photo_path, allocations: invoices.filter((i) => Number(amounts[i.invoice_id]) > 0).map((i) => ({ invoice_id: i.invoice_id, amount: Number(amounts[i.invoice_id]) })) });
      onDone(`Payment of ${peso(total)} reported. The cashier will confirm it.`);
    } catch (e) { setError(errorText(e)); }
  });
  return (
    <div className="space-y-3 text-sm">
      <label className="block">Client
        <select className="input mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Choose the client…</option>{clients.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.legal_name} · open {peso(c.open_balance)}</option>)}
        </select>
      </label>
      {clientId && (invoices.length ? (
        <>
          <div className="flex flex-wrap items-end gap-2 text-xs"><label className="block">Amount received<input className="input mt-0.5 w-36" type="number" min="0" step="0.01" value={spread} onChange={(e) => setSpread(e.target.value)} /></label>
            <button type="button" className="button-secondary" onClick={fillOldest}>Apply to oldest DRs first</button><span className="pb-2 text-slate-500">or type the amount per DR below</span></div>
          <div className="overflow-x-auto rounded border">
            <div className="divide-y text-xs">{invoices.map((i) => (
              <div key={i.invoice_id} className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{i.dr_numbers || i.invoice_number}</div>
                  <div className="text-slate-500">{[i.si_number && `SI ${i.si_number}`, i.invoice_date].filter(Boolean).join(' · ')}{i.due_date && i.due_date < manilaToday() && <span className="text-red-700"> · due {i.due_date}</span>}</div>
                  <div className="text-slate-600">Balance {peso(i.balance_due)}{Number(i.reported) > 0 ? ` · reported ${peso(i.reported)}` : ''}</div>
                </div>
                <input className="input w-28 flex-none text-right" type="number" inputMode="decimal" min="0" max={left(i)} step="0.01" placeholder="Paid now" value={amounts[i.invoice_id] ?? ''} disabled={left(i) <= 0}
                  onChange={(e) => setAmounts({ ...amounts, [i.invoice_id]: e.target.value })} aria-label="Paid now" />
              </div>
            ))}</div>
          </div>
          <div className="text-right font-semibold">Total {peso(total)}</div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">Paid by<select className="input mt-1" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="block">{f.method === 'check' ? 'Check no. *' : f.method === 'cash' ? 'Reference (optional)' : 'Reference no. *'}<input className="input mt-1" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            <label className="block">Date paid<input className="input mt-1" type="date" value={f.paid_on} max={manilaToday()} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></label>
            {f.method === 'check' && <>
              <label className="block">Bank<input className="input mt-1" value={f.check_bank} onChange={(e) => setF({ ...f, check_bank: e.target.value })} /></label>
              <label className="block">Date on the check<input className="input mt-1" type="date" value={f.check_date} onChange={(e) => setF({ ...f, check_date: e.target.value })} /></label>
              <label className="block">Issued by<input className="input mt-1" value={f.issuer} onChange={(e) => setF({ ...f, issuer: e.target.value })} /></label>
            </>}
          </div>
          <label className="block">Photo of the deposit slip / check (optional)<input className="mt-1 block text-xs" type="file" accept="image/*,application/pdf" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
          <input className="input" placeholder="Notes for the cashier" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </>
      ) : <p className="text-slate-500">This client has no open DR / invoice approved by Finance.</p>)}
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !clientId || total <= 0} onClick={submit}>{pending ? 'Sending…' : 'Report payment'}</button>
    </div>
  );
}

export function AgentPayments({ reports, clients, initialClient }: { reports: any[]; clients: AgentClient[]; initialClient: string }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const [pending, start] = useTransition();
  const view = (path: string) => start(async () => { try { window.open(await agentPhotoUrlAction(path), '_blank'); } catch (e) { setMessage(errorText(e)); } });
  const cancel = (r: any) => start(async () => { try { await cancelPaymentAction(r.id); setMessage(`${r.report_number} cancelled.`); router.refresh(); } catch (e) { setMessage(errorText(e)); } });
  return (
    <div className="space-y-3">
      <ActionBar>
        <PopupAction label="+ Report a payment" title="Report a client payment" wide openParam="pay" notice={message}>
          {(close) => <ReportForm clients={clients} initialClient={initialClient} onDone={(m) => { setMessage(m); close(); router.refresh(); }} />}
        </PopupAction>
      </ActionBar>
      {message && <div className="rounded border bg-white p-2 text-sm">{message}</div>}
      <div className="grid gap-3 md:grid-cols-2">
        {reports.map((r) => (
          <div key={r.id} className="space-y-1 rounded-xl border bg-white p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><div className="font-medium leading-snug">{r.customer}</div>
                <div className="font-mono text-[11px] text-slate-500">{r.report_number} · paid {r.paid_on}</div></div>
              <div className="flex-none text-right"><div className="font-semibold">{peso(r.amount)}</div><Pill status={r.status} label={r.status === 'pending' ? 'waiting for cashier' : undefined} /></div>
            </div>
            <div className="text-xs text-slate-600">{METHODS.find((m) => m[0] === r.method)?.[1] ?? r.method}{r.reference ? ` · ${r.reference}` : ''}</div>
            <div className="text-xs text-slate-600">{(r.allocations ?? []).map((a: any, i: number) => <span key={i} className="mr-2 inline-block">{a.dr_numbers || a.invoice_number}: {peso(a.amount)}</span>)}</div>
            {r.decision_note && <div className="text-xs text-red-700">{r.decision_note}</div>}
            {(r.photo_path || r.status === 'pending') && <div className="flex gap-3 pt-1 text-xs">
              {r.photo_path && <button type="button" className="text-blue-700 underline" disabled={pending} onClick={() => view(r.photo_path)}>Photo</button>}
              {r.status === 'pending' && <button type="button" className="text-red-700 underline" disabled={pending} onClick={() => cancel(r)}>Cancel</button>}
            </div>}
          </div>
        ))}
      </div>
      {!reports.length && <div className="rounded-xl border bg-white p-6 text-center text-sm text-slate-500">No payments reported in this store yet.</div>}
    </div>
  );
}
