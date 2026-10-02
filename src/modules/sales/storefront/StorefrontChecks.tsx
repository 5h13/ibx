'use client';

// Build 74 — SF-27 customer checks received at the counter (post-dated
// included). Accepting a check needs no approver; depositing, clearing and
// marking a bounced check is for a Sales approver, Business Admin or Finance.
// A bounced check goes back to the customer's balance in AR (a walk-in's check
// is charged to a named customer record for the issuer).

import { useState, useTransition } from 'react';
import { errorText } from '@/core/errors/appError';
import { PopupAction } from '@/core/ui/PopupAction';
import { checkAction } from './actions';
import { useStoreAccounts } from './accountsContext';
import { peso } from './storefrontShared';

type Customer = { id: string; legal_name: string };
const STATUS: Record<string, string> = { on_hand: 'On hand', deposited: 'Deposited', cleared: 'Cleared', bounced: 'Bounced' };
const badge = (s: string) => s === 'cleared' ? 'bg-emerald-100 text-emerald-800' : s === 'bounced' ? 'bg-red-100 text-red-800' : s === 'deposited' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800';

function Err({ t }: { t: string }) { return t ? <div className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{t}</div> : null; }

function DepositForm({ k, today, onDone }: { k: any; today: string; onDone: (m: string) => void }) {
  const banks = useStoreAccounts().filter((a) => a.method === 'bank_transfer');
  const [bank, setBank] = useState(banks.length === 1 ? banks[0].id : '');
  const [date, setDate] = useState(today);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p>{k.check_number} · {k.bank_name} · dated {k.check_date} · {peso(k.amount)}</p>
      {banks.length === 0 && <p className="text-amber-700">Set up the store's bank account first (Store settings → Receiving accounts, "Bank transfer").</p>}
      <label className="block">Deposited to *<select className="input mt-1" value={bank} onChange={(e) => setBank(e.target.value)}>
        <option value="">Choose the bank account</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}{b.number ? ` · ${b.number}` : ''}</option>)}</select></label>
      <label className="block">Deposit date<input className="input mt-1" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <p className="text-xs text-slate-500">Finance gets a journal (bank / checks on hand) and the Bank/Cash entries to review and post.</p>
      <Err t={error} />
      <div className="flex justify-end"><button className="button" disabled={pending || !bank} onClick={() => start(async () => {
        try { await checkAction(k.id, 'deposit', { bank_account: bank, date }); onDone(`Check ${k.check_number} recorded as deposited.`); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Record deposit'}</button></div>
    </div>
  );
}

function BounceForm({ k, today, customers, walkInId, onDone }: { k: any; today: string; customers: Customer[]; walkInId: string; onDone: (m: string) => void }) {
  const needsCustomer = !k.customer_id || k.customer_id === walkInId;
  const [reason, setReason] = useState('');
  const [customer, setCustomer] = useState('');
  const [name, setName] = useState(k.issuer_name ?? '');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p>{k.check_number} · {k.bank_name} · {peso(k.amount)} · {STATUS[k.status]}</p>
      <input className="input" placeholder="Why did it bounce? (e.g. insufficient funds) *" value={reason} onChange={(e) => setReason(e.target.value)} />
      {needsCustomer && (
        <div className="space-y-2 rounded border p-2">
          <p className="text-xs text-slate-600">This check came from a walk-in. The amount is owed again, so it is charged to a named customer:</p>
          <select className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">New customer record for the issuer (below)</option>
            {customers.filter((c) => c.id !== walkInId).map((c) => <option key={c.id} value={c.id}>{c.legal_name}</option>)}
          </select>
          {!customer && <div className="grid gap-2 sm:grid-cols-2"><input className="input" placeholder="Issuer's name *" value={name} onChange={(e) => setName(e.target.value)} /><input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>}
        </div>
      )}
      <p className="text-xs text-slate-500">An AR invoice for {peso(k.amount)} is raised for the customer and the check is reversed out of {k.status === 'deposited' ? 'the bank' : 'Checks on hand'} (journal for Finance).</p>
      <Err t={error} />
      <div className="flex justify-end"><button className="button" disabled={pending || !reason.trim() || (needsCustomer && !customer && !name.trim())} onClick={() => start(async () => {
        try {
          const r = await checkAction(k.id, 'bounce', { reason, date: today, customer_id: customer || null, new_customer_name: customer ? null : name, phone });
          onDone(`Check ${k.check_number} marked bounced; ${r.invoice_number} raised in AR.`);
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Mark bounced'}</button></div>
    </div>
  );
}

export function ChecksTab({ checks, today, canHandle, customers, walkInId, onMessage }: { checks: any[]; today: string; canHandle: boolean; customers: Customer[]; walkInId: string; onMessage: (m: string) => void }) {
  const [pending, start] = useTransition();
  const onHand = checks.filter((k) => k.status === 'on_hand');
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-500">Customer checks received at the counter. Post-dated checks stay in Checks on hand until their date; a reminder goes to approvers and Finance when the date arrives.
        {' '}On hand now: <b>{peso(onHand.reduce((s, k) => s + Number(k.amount), 0))}</b> ({onHand.length}).</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="p-2">Check</th><th className="p-2">Bank</th><th className="p-2">Date on check</th><th className="p-2">From</th><th className="p-2">Received</th><th className="p-2 text-right">Amount</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>
            {checks.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-slate-500">No checks received yet.</td></tr>}
            {checks.map((k) => {
              const pdc = k.check_date > today;
              return (
                <tr key={k.id} className="border-b align-top">
                  <td className="p-2 font-medium">{k.check_number}<div className="text-xs font-normal text-slate-500">{k.payment?.payment_number} · <a className="underline" href={`/sales/storefront/payments/${k.payment_id}/receipt`} target="_blank" rel="noreferrer">receipt</a></div></td>
                  <td className="p-2">{k.bank_name}</td>
                  <td className="p-2">{k.check_date}{k.status === 'on_hand' && (pdc ? <div className="text-xs text-amber-700">post-dated</div> : <div className="text-xs text-emerald-700">can be deposited</div>)}</td>
                  <td className="p-2">{k.customer?.legal_name ?? '—'}{k.issuer_name ? <div className="text-xs text-slate-500">issuer: {k.issuer_name}</div> : null}</td>
                  <td className="p-2 text-xs">{k.created_at ? new Date(k.created_at).toLocaleDateString('en-PH') : ''}</td>
                  <td className="p-2 text-right">{peso(k.amount)}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${badge(k.status)}`}>{STATUS[k.status] ?? k.status}</span>
                    {k.status === 'bounced' && <div className="text-xs text-slate-500">{k.bounce_reason}</div>}
                    {k.status === 'deposited' && <div className="text-xs text-slate-500">{k.deposited_on}</div>}</td>
                  <td className="p-2 whitespace-nowrap">{canHandle && <div className="flex gap-2">
                    {k.status === 'on_hand' && !pdc && <PopupAction label="Deposit" title={`Deposit check ${k.check_number}`}>{(close) => <DepositForm k={k} today={today} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>}
                    {k.status === 'deposited' && <button className="button-secondary" disabled={pending} onClick={() => start(async () => { try { await checkAction(k.id, 'clear', { date: today }); onMessage(`Check ${k.check_number} cleared.`); } catch (e) { onMessage(errorText(e)); } })}>Cleared</button>}
                    {['on_hand', 'deposited'].includes(k.status) && <PopupAction label="Bounced…" title={`Bounced check ${k.check_number}`} variant="secondary" wide>{(close) => <BounceForm k={k} today={today} customers={customers} walkInId={walkInId} onDone={(m) => { onMessage(m); close(); }} />}</PopupAction>}
                  </div>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!canHandle && <p className="text-xs text-slate-500">A Sales approver, Business Admin or Finance records deposits, clearing and bounced checks.</p>}
    </div>
  );
}
