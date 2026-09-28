'use client';

// Build 71 — Store settings, Finance part: the SI booklet the store issues
// from (VAT follows the booklet), the business's VAT registration (Super
// Admin) and the receiving accounts (cash drawer, GCash / Maya numbers, card
// clearing, bank) that counter payments go into.

import { useEffect, useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import {
  addReceivingAccountAction, bookletOptionsAction, receivingAccountsAction, setBookletAction, setReceivingAccountActiveAction, setVatRegisteredAction,
  type PaymentInput, type ReceivingAccount,
} from './actions';
import { METHODS, methodLabel } from './storefrontShared';

type Ctx = { business_id: string; is_super_admin?: boolean; booklet_business_id?: string; booklet_vat?: boolean; own_vat?: boolean };

export function StoreSettingsExtra({ ctx, onMessage }: { ctx: Ctx; onMessage: (m: string) => void }) {
  const [booklets, setBooklets] = useState<{ id: string; code: string; name: string; vat_registered: boolean }[]>([]);
  const [booklet, setBooklet] = useState(ctx.booklet_business_id ?? ctx.business_id);
  const [accounts, setAccounts] = useState<ReceivingAccount[]>([]);
  const [add, setAdd] = useState<{ method: PaymentInput['method']; name: string; number: string; bank: string }>({ method: 'gcash', name: '', number: '', bank: '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const reload = () => receivingAccountsAction().then(setAccounts).catch((e) => setError(errorText(e)));
  useEffect(() => {
    bookletOptionsAction().then(setBooklets).catch((e) => setError(errorText(e)));
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (fn: () => Promise<unknown>, ok: string) => start(async () => { setError(''); try { await fn(); onMessage(ok); await reload(); } catch (e) { setError(errorText(e)); } });
  const chosen = booklets.find((b) => b.id === booklet);

  return (
    <div className="space-y-5 border-t pt-4">
      <section className="space-y-2">
        <h4 className="font-semibold">SI booklet and VAT</h4>
        <label className="block">SIs of this store are issued from the BIR booklet of
          <select className="input mt-1" value={booklet} onChange={(e) => setBooklet(e.target.value)}>
            {booklets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.code}){b.id === ctx.business_id ? ' — this store' : ''} · {b.vat_registered ? 'VAT-registered' : 'non-VAT'}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500">A sale with an SI from a VAT-registered booklet carries VAT (prices include VAT: price × 12/112); a DR-only sale has none. The sale stays in this store's books either way; SI numbers are checked across every store using the same booklet.{chosen && !chosen.vat_registered ? ' This booklet is non-VAT, so no VAT is charged.' : ''}</p>
        <button type="button" className="button-secondary" disabled={pending || booklet === (ctx.booklet_business_id ?? ctx.business_id)} onClick={() => run(() => setBookletAction(booklet), 'SI booklet saved.')}>Save booklet</button>
        {ctx.is_super_admin && (
          <div className="flex items-center gap-3 rounded bg-slate-50 p-2">
            <span>This business is <b>{ctx.own_vat ? 'VAT-registered' : 'not VAT-registered'}</b></span>
            <button type="button" className="button-secondary" disabled={pending} onClick={() => run(() => setVatRegisteredAction(!ctx.own_vat), `VAT registration ${ctx.own_vat ? 'removed' : 'set'}.`)}>{ctx.own_vat ? 'Mark as non-VAT' : 'Mark as VAT-registered'}</button>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="font-semibold">Receiving accounts</h4>
        <p className="text-xs text-slate-500">Every counter payment goes into one of these (Finance → Bank/Cash). Each GCash / Maya number (SIM) is its own account; when a method has more than one, the cashier picks which one received the payment.</p>
        <table className="w-full">
          <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Method</th><th className="p-2">Account</th><th className="p-2">Number</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a.id} className="border-b">
              <td className="p-2">{methodLabel(a.payment_method)}</td><td className="p-2">{a.account_name}{a.bank_name && a.payment_method === 'bank_transfer' ? ` · ${a.bank_name}` : ''}</td>
              <td className="p-2">{a.mobile_number ?? a.account_number_masked ?? '—'}</td><td className="p-2">{a.active ? 'Active' : 'Inactive'}</td>
              <td className="p-2"><button type="button" className="button-secondary" disabled={pending} onClick={() => run(() => setReceivingAccountActiveAction(a.id, !a.active), `${a.account_name} ${a.active ? 'deactivated' : 'activated'}.`)}>{a.active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>))}</tbody>
        </table>
        <div className="grid gap-2 rounded border p-3 sm:grid-cols-5">
          <select className="input" value={add.method} onChange={(e) => setAdd({ ...add, method: e.target.value as PaymentInput['method'] })}>{METHODS.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
          <input className="input" placeholder="Name, e.g. GCash counter 1" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
          <input className="input" placeholder={add.method === 'gcash' || add.method === 'maya' ? 'Mobile number (SIM) *' : add.method === 'bank_transfer' ? 'Account number *' : 'Number (optional)'} value={add.number} onChange={(e) => setAdd({ ...add, number: e.target.value })} />
          {add.method === 'bank_transfer' ? <input className="input" placeholder="Bank, e.g. BDO" value={add.bank} onChange={(e) => setAdd({ ...add, bank: e.target.value })} /> : <span />}
          <button type="button" className="button" disabled={pending || !add.name.trim()} onClick={() => run(async () => { await addReceivingAccountAction(add); setAdd({ ...add, name: '', number: '', bank: '' }); }, `${add.name} added.`)}>Add account</button>
        </div>
      </section>
      {error && <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    </div>
  );
}
