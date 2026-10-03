'use client';
import { Form } from '@/core/ui/Form';
// Build 77 — DOC-03 (Procurement side). Sales flags quotation lines "awaiting
// supplier price"; Procurement compares suppliers outside the system and
// records only the decision here: chosen supplier, price, validity, lead time
// and terms. Optionally the price goes into the supplier quote log and becomes
// the item's current cost (DOC-14 "Set as current cost").
import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { PopupAction } from '@/core/ui/PopupAction';
import { answerPriceRequestAction } from './actions';

const money = (n: unknown) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VALIDITY: Record<string, string> = { while_supply_lasts: 'While supply lasts', fixed_price: 'Fixed price' };
const daysSince = (iso?: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);

type Req = {
  quotation_item_id: string; quotation_number: string; quotation_status: string; customer: string | null; item_code: string | null; item_name: string;
  description: string; quantity: number; unit: string; status: 'awaiting' | 'answered'; note: string | null; requested_by: string | null; requested_at: string | null;
  current_cost: number | null; cost_updated_at: string | null; chosen_supplier_id: string | null; chosen_supplier: string | null; supplier_unit_price: number | null;
  supplier_validity: string | null; supplier_lead_time: string | null; supplier_terms: string | null; answered_by: string | null; answered_at: string | null;
  line_unit_price: number; recent_quotes: { supplier_id: string; supplier: string; unit_price: number; validity: string; lead_time: string; recorded_at: string }[];
};

export function PriceRequests({ requests, suppliers, showAnswered }: { requests: Req[]; suppliers: any[]; showAnswered: boolean }) {
  const [message, setMessage] = useState('');
  const awaiting = requests.filter((r) => r.status === 'awaiting');
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Supplier price requests</h1>
        <p className="text-sm text-slate-500">Quotation lines Sales asked about. Check suppliers, then record the chosen supplier and price — Sales is notified and the quote line is re-priced from it.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-800">{awaiting.length} awaiting</span>
        <a className="underline" href={showAnswered ? '/finance/price-requests' : '/finance/price-requests?answered=1'}>{showAnswered ? 'Hide answered' : 'Show answered'}</a>
        <a className="underline" href="/finance/procurement">Procurement</a>
      </div>
      {message && <div className="rounded-lg bg-slate-100 px-4 py-2 text-sm">{message}</div>}
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-slate-500"><th className="p-3">Quotation</th><th className="p-3">Item</th><th className="p-3 text-right">Qty</th>
            <th className="p-3">Requested</th><th className="p-3">Current cost</th><th className="p-3">Decision</th><th className="p-3" /></tr></thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.quotation_item_id} className="border-b align-top">
                <td className="p-3"><div className="font-medium">{r.quotation_number}</div><div className="text-xs text-slate-500">{r.customer ?? '—'} · {r.quotation_status}</div></td>
                <td className="p-3"><div>{r.item_name}</div><div className="text-xs text-slate-500">{r.item_code ?? ''}{r.description !== r.item_name ? ` · ${r.description}` : ''}</div></td>
                <td className="p-3 text-right">{Number(r.quantity).toLocaleString()} {r.unit}</td>
                <td className="p-3 text-xs">{r.requested_by ?? '—'}<div className="text-slate-500">{r.requested_at ? new Date(r.requested_at).toLocaleString() : ''}</div>{r.note && <div className="mt-1 italic">“{r.note}”</div>}</td>
                <td className="p-3 text-xs">{r.current_cost === null ? '—' : money(r.current_cost)}{daysSince(r.cost_updated_at) !== null && <div className="text-slate-500">{daysSince(r.cost_updated_at)} day(s) old</div>}</td>
                <td className="p-3 text-xs">{r.status === 'answered' && r.chosen_supplier
                  ? <><div className="font-medium">{r.chosen_supplier} · {money(r.supplier_unit_price)}</div><div>{VALIDITY[r.supplier_validity ?? ''] ?? r.supplier_validity} · {r.supplier_lead_time}{r.supplier_terms ? ` · ${r.supplier_terms}` : ''}</div>
                      <div className="text-slate-500">by {r.answered_by ?? '—'} · line now {money(r.line_unit_price)}</div></>
                  : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Awaiting supplier price</span>}</td>
                <td className="p-3">{r.quotation_status === 'draft' && (
                  <PopupAction label={r.status === 'answered' ? 'Change' : 'Record supplier price'} title={`${r.item_name} · ${r.quotation_number}`} variant={r.status === 'answered' ? 'secondary' : 'primary'}>
                    {(close) => <AnswerForm r={r} suppliers={suppliers} onDone={(m) => { setMessage(m); close(); }} />}
                  </PopupAction>)}</td>
              </tr>
            ))}
            {requests.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">No supplier price requests waiting.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnswerForm({ r, suppliers, onDone }: { r: Req; suppliers: any[]; onDone: (m: string) => void }) {
  const [supplierId, setSupplierId] = useState(r.chosen_supplier_id ?? '');
  const [price, setPrice] = useState(r.supplier_unit_price === null ? '' : String(r.supplier_unit_price));
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const [log, setLog] = useState(true);
  const terms = suppliers.find((s) => s.id === supplierId)?.payment_terms ?? '';
  return (
    <Form className="space-y-3 text-sm" action={(fd) => {
      setError('');
      fd.set('quotation_item_id', r.quotation_item_id);
      start(async () => {
        try {
          const x = await answerPriceRequestAction(fd);
          onDone(`${x.quotation_number}: supplier price recorded, line re-priced to ${money(x.line_price)}${x.logged ? '; logged in the supplier quote log' : ''}${x.current_cost_set ? ' and set as the current cost' : ''}. Sales was notified.`);
        } catch (e) { setError(errorText(e)); }
      });
    }}>
      <p className="text-slate-600">{Number(r.quantity).toLocaleString()} {r.unit} for {r.customer ?? 'the customer'}. Compare suppliers outside the system; record only the one chosen.</p>
      {r.recent_quotes.length > 0 && (
        <div className="rounded bg-slate-50 p-2 text-xs"><div className="mb-1 font-medium">Recent supplier quotes for this item</div>
          {r.recent_quotes.map((q, i) => <button type="button" key={i} className="block underline" onClick={() => { setSupplierId(q.supplier_id); setPrice(String(q.unit_price)); }}>
            {q.supplier} · {money(q.unit_price)} · {VALIDITY[q.validity] ?? q.validity} · {q.lead_time} · {new Date(q.recorded_at).toLocaleDateString()}</button>)}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">Supplier *<select className="input mt-1" name="supplier_id" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
          <option value="">Select a registered supplier</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code ? `${s.supplier_code} — ` : ''}{s.legal_name}</option>)}</select></label>
        <label className="block">Supplier unit price *<input className="input mt-1" name="unit_price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} required /></label>
        <label className="block">Validity<select className="input mt-1" name="validity" defaultValue={r.supplier_validity ?? 'while_supply_lasts'}>
          <option value="while_supply_lasts">While supply lasts</option><option value="fixed_price">Fixed price</option></select></label>
        <label className="block">Lead time<input className="input mt-1" name="lead_time" defaultValue={r.supplier_lead_time ?? 'Within the day'} /></label>
        <label className="block sm:col-span-2">Terms<input className="input mt-1" name="terms" defaultValue={r.supplier_terms ?? ''} placeholder={terms ? `Supplier master: ${terms}` : 'From the supplier master if left blank'} /></label>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" name="log_quote" value="1" checked={log} onChange={(e) => setLog(e.target.checked)} /> Also record it in the supplier quote log</label>
      <label className={`flex items-center gap-2 ${log ? '' : 'opacity-50'}`}><input type="checkbox" name="set_current_cost" value="1" disabled={!log} /> Set as the item&apos;s current cost (shared by all businesses)</label>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>}
      <div className="flex justify-end"><button className="button" disabled={pending}>{pending ? 'Saving…' : 'Record and notify Sales'}</button></div>
    </Form>
  );
}
