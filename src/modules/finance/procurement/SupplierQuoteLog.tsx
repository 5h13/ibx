'use client';
import { Form } from '@/core/ui/Form';
import { errorText } from '@/core/errors/appError';

// Build 56 — Supplier quote log (DOC-14) + "Set as current cost" (DOC-04).
// Supplier prices received in Viber/Messenger chats are recorded here:
// catalog item, registered supplier, price, validity, lead time. Procurement
// chooses which entry becomes the item's current cost (shared by all
// businesses); the catalog pricing formula then uses it for every quote.

import { useMemo, useState, useTransition } from 'react';
import { useDialog } from '@/core/ui/Dialog';
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';
import { CatalogItemPicker } from '@/shared/catalog/CatalogItemPicker';
import { createSupplierQuoteAction, updateSupplierQuoteAction, deleteSupplierQuoteAction, setCurrentCostFromQuoteAction } from './supplierQuoteActions';
import { costAgeLabel } from './supplierQuoteAccess';

type Quote = {
  id: string; item_id: string; supplier_id: string; unit_price: number; validity: 'while_supply_lasts' | 'fixed_price'; lead_time: string; created_at: string;
  item?: { id: string; item_code: string; item_name: string; unit: string | null; item_type: string | null; standard_cost: number | null; service_cost_basis: number | null; cost_updated_at: string | null; cost_source_quote_id: string | null } | null;
  supplier?: { supplier_code: string; legal_name: string; payment_terms: string | null } | null;
  business?: { code: string } | null;
};

const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const VALIDITY_LABEL = { while_supply_lasts: 'While supply lasts', fixed_price: 'Fixed price' } as const;


export default function SupplierQuoteLog({ quotes, suppliers, canManage }: { quotes: Quote[]; suppliers: any[]; canManage: boolean }) {
  const dialog = useDialog();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<Quote | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [formKey, setFormKey] = useState(0);
  const run = (fn: () => Promise<any>, ok = 'Saved.') => start(async () => { try { await fn(); setMessage(ok); } catch (e: any) { setMessage(errorText(e) || 'Action failed.'); } });

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return quotes;
    return quotes.filter((q) => [q.item?.item_code, q.item?.item_name, q.supplier?.legal_name, q.supplier?.supplier_code].some((v) => String(v || '').toLowerCase().includes(f)));
  }, [quotes, filter]);

  const chosenSupplier = suppliers.find((s) => s.id === supplierId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Supplier Quotes</h1>
        <p className="text-sm text-slate-500">Supplier prices received through Viber, Messenger or calls, recorded so they are not lost in the chats. Procurement chooses which price becomes an item's current cost; quotes are then priced from the catalog as usual. Shared by all businesses.</p>
      </div>
      {canManage && (
        <ActionBar>
          <PopupAction label="Record supplier quote" title="Record a supplier quote" notice={message} wide>
            {(close) => (
          <Form key={formKey} action={(fd) => run(async () => { await createSupplierQuoteAction(fd); setFormKey((k) => k + 1); setSupplierId(''); close(); }, 'Supplier quote recorded.')} className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2"><label className="label">Item</label><CatalogItemPicker name="item_id" required /></div>
            <div className="md:col-span-2"><label className="label">Supplier</label>
              <select className="input w-full" name="supplier_id" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select supplier</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.supplier_code} — {s.legal_name}</option>)}
              </select>
              <div className="mt-1 text-xs text-slate-500">{chosenSupplier ? `Terms: ${chosenSupplier.payment_terms || 'not set on supplier record'}` : 'New supplier? Register it in Procurement → Suppliers first.'}</div>
            </div>
            <div><label className="label">Price (per unit)</label><input className="input w-full" name="unit_price" type="number" min="0" step="0.01" required /></div>
            <div><label className="label">Validity</label><select className="input w-full" name="validity" defaultValue="while_supply_lasts"><option value="while_supply_lasts">While supply lasts</option><option value="fixed_price">Fixed price</option></select></div>
            <div className="md:col-span-2"><label className="label">Lead time</label><input className="input w-full" name="lead_time" defaultValue="Within the day" /></div>
            <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" name="set_as_current" /> Also set as the item's current cost</label>
            <div className="md:col-span-1 md:col-start-6"><button className="button w-full" disabled={pending}>Save quote</button></div>
          </Form>
            )}
          </PopupAction>
        </ActionBar>
      )}
      {message && <div className="rounded-lg bg-slate-100 px-4 py-2 text-sm">{message}</div>}


      <section className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Quote log</h3>
          <input className="input w-full sm:w-72" placeholder="Filter by item or supplier" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Recorded</th><th className="p-2">Item</th><th className="p-2">Supplier</th><th className="p-2 text-right">Price</th><th className="p-2">Validity</th><th className="p-2">Lead time</th><th className="p-2">Item's current cost</th>{canManage && <th className="p-2" />}</tr>
            </thead>
            <tbody>
              {shown.map((q) => {
                const isCurrent = q.item?.cost_source_quote_id === q.id;
                const current = q.item?.item_type === 'service' ? q.item?.service_cost_basis : q.item?.standard_cost;
                return (
                  <tr key={q.id} className="border-t align-top">
                    <td className="p-2 whitespace-nowrap">{new Date(q.created_at).toLocaleDateString()}<div className="text-xs text-slate-400">{q.business?.code ?? ''}</div></td>
                    <td className="p-2"><span className="font-medium">{q.item?.item_code}</span> — {q.item?.item_name}</td>
                    <td className="p-2">{q.supplier?.legal_name}<div className="text-xs text-slate-400">{q.supplier?.payment_terms || ''}</div></td>
                    <td className="p-2 text-right font-semibold">{peso(q.unit_price)}{q.item?.unit ? <span className="text-xs font-normal text-slate-400"> /{q.item.unit}</span> : null}</td>
                    <td className="p-2">{VALIDITY_LABEL[q.validity]}</td>
                    <td className="p-2">{q.lead_time}</td>
                    <td className="p-2">
                      {isCurrent ? <span className="rounded bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">Current cost</span> : <span>{current == null ? '—' : peso(current)}</span>}
                      <div className="text-xs text-slate-500">{costAgeLabel(q.item?.cost_updated_at)}</div>
                    </td>
                    {canManage && (
                      <td className="p-2 whitespace-nowrap space-x-1">
                        {!isCurrent && <button className="button-secondary" disabled={pending} onClick={async () => { if (await dialog.confirm(`Set ${peso(q.unit_price)} from ${q.supplier?.legal_name} as the current cost of ${q.item?.item_code}? This changes catalog pricing for every business.`)) run(() => setCurrentCostFromQuoteAction(q.id), 'Current cost updated.'); }}>Set as current cost</button>}
                        <button className="button-secondary" disabled={pending} onClick={() => setEditing(q)}>Edit</button>
                        <button className="button-secondary" disabled={pending || isCurrent} title={isCurrent ? 'This quote is the item\'s current cost' : undefined} onClick={async () => { if (await dialog.confirm('Delete this supplier quote?', { tone: 'danger' })) run(() => deleteSupplierQuoteAction(q.id), 'Supplier quote deleted.'); }}>Delete</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!shown.length && <tr><td colSpan={canManage ? 8 : 7} className="p-6 text-center text-slate-500">{quotes.length ? 'No quotes match the filter.' : 'No supplier quotes recorded yet.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {quotes.length >= 500 && <p className="mt-2 text-xs text-slate-400">Showing the latest 500 quotes.</p>}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b p-4"><div><h3 className="font-semibold">Edit supplier quote</h3><p className="text-xs text-slate-500">{editing.item?.item_code} — {editing.supplier?.legal_name}</p></div><button className="button-secondary" onClick={() => setEditing(null)}>Close</button></div>
            <Form action={(fd) => run(async () => { await updateSupplierQuoteAction(fd); setEditing(null); }, 'Supplier quote updated.')} className="grid gap-3 p-4">
              <input type="hidden" name="quote_id" value={editing.id} />
              <label className="text-sm">Price (per unit)<input className="input mt-1 w-full" name="unit_price" type="number" min="0" step="0.01" defaultValue={editing.unit_price} required /></label>
              <label className="text-sm">Validity<select className="input mt-1 w-full" name="validity" defaultValue={editing.validity}><option value="while_supply_lasts">While supply lasts</option><option value="fixed_price">Fixed price</option></select></label>
              <label className="text-sm">Lead time<input className="input mt-1 w-full" name="lead_time" defaultValue={editing.lead_time} /></label>
              {editing.item?.cost_source_quote_id === editing.id && <p className="text-xs text-amber-700">This quote is the item's current cost, so saving a new price also updates the current cost (for every business).</p>}
              <button className="button" disabled={pending}>Save</button>
            </Form>
          </div>
        </div>
      )}
    </div>
  );
}
