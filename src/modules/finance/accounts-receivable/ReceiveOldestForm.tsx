'use client';
// Build 88 (AR-02): Finance records one customer payment; it is split over the
// customer's open invoices oldest first, as draft receipts (one per invoice)
// that then go through the usual prepare / review / approve / post.
import { useEffect, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { arOldestPreviewAction, createOldestReceiptsAction, type OldestPart } from '../accountsReceivableActions';

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ReceiveOldestForm({ customers, onDone }: { customers: { id: string; customer_code: string; legal_name: string }[]; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ customer_id: '', amount: '', receipt_number: '', receipt_date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), payment_method: 'Bank transfer', reference_number: '', bank_account: '' });
  const [parts, setParts] = useState<OldestPart[] | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const amount = Number(f.amount) || 0;
  const owed = (parts ?? []).reduce((s, x) => s + Number(x.balance), 0);
  useEffect(() => {
    if (!f.customer_id) { setParts(null); return; }
    let alive = true;
    const t = setTimeout(() => { arOldestPreviewAction(f.customer_id, amount).then((r) => { if (alive) setParts(r); }).catch((e) => { if (alive) setError(errorText(e)); }); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [f.customer_id, amount]);
  const save = () => { setError(''); start(async () => { try {
    const r = await createOldestReceiptsAction({ ...f, amount });
    onDone(`${r.count} draft receipt(s) saved for ${peso(amount)}, oldest first: ${r.parts.map((x) => `${x.dr ? 'DR ' + x.dr : x.invoice_number} ${peso(x.applied)}`).join('; ')}. Prepare, review, approve and post them as usual.`);
  } catch (e) { setError(errorText(e)); } }); };
  const box = (k: keyof typeof f, label: string, type = 'text') => <label className="block text-sm"><span className="mb-1 block text-slate-600">{label}</span><input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 md:grid-cols-4">
        <label className="block text-sm md:col-span-2"><span className="mb-1 block text-slate-600">Customer</span>
          <select className="input" value={f.customer_id} onChange={(e) => setF({ ...f, customer_id: e.target.value })}>
            <option value="">Select customer</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.customer_code} — {c.legal_name}</option>)}
          </select></label>
        {box('amount', 'Amount received', 'number')}{box('receipt_number', 'Receipt number')}
        {box('receipt_date', 'Receipt date', 'date')}
        <label className="block text-sm"><span className="mb-1 block text-slate-600">Method</span>
          <select className="input" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>{['Bank transfer', 'Cheque', 'Cash', 'Card', 'Other'].map((m) => <option key={m}>{m}</option>)}</select></label>
        {box('reference_number', 'Reference')}{box('bank_account', 'Bank account')}
      </div>
      {parts && parts.length === 0 && <p className="text-slate-500">This customer has no unpaid approved invoices.</p>}
      {parts && parts.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full">
            <thead><tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500"><th className="p-2">DR / invoice</th><th className="p-2">Date</th><th className="p-2">Due</th><th className="p-2 text-right">Balance</th><th className="p-2 text-right">This payment</th><th className="p-2 text-right">Left</th></tr></thead>
            <tbody>
              {parts.map((x) => <tr key={x.invoice_id} className="border-b"><td className="p-2">{[x.dr && `DR ${x.dr}`, x.si && `SI ${x.si}`].filter(Boolean).join(' · ') || x.invoice_number}</td><td className="p-2">{x.invoice_date}</td><td className="p-2">{x.due_date ?? '—'}</td>
                <td className="p-2 text-right">{peso(x.balance)}</td><td className="p-2 text-right font-medium text-emerald-700">{Number(x.applied) > 0 ? peso(x.applied) : '—'}</td><td className="p-2 text-right">{peso(x.remaining)}</td></tr>)}
              <tr><td colSpan={3} className="p-2 text-right text-slate-500">Total owed</td><td className="p-2 text-right font-semibold">{peso(owed)}</td><td className="p-2 text-right font-semibold">{peso(Math.min(amount, owed))}</td><td className="p-2 text-right font-semibold">{peso(Math.max(owed - amount, 0))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      {amount > owed && parts && parts.length > 0 && <p className="text-red-700">That is more than the customer owes ({peso(owed)}).</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.customer_id || !(amount > 0) || amount > owed || !f.receipt_number.trim()} onClick={save}>{pending ? 'Saving…' : `Save draft receipts (${peso(amount)})`}</button>
    </div>
  );
}
