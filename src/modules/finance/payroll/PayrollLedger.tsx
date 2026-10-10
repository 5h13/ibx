'use client';
// Build 100 — payroll in the ledger: "Post (paid)" asks which bank / cash account the net pay left from;
// "Remit" pays SSS / PhilHealth / Pag-IBIG / withholding tax (or other deductions) out of their payables.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { payrollLiabilitiesAction, payrollRemitAction, postPayrollRunAction } from '@/modules/finance/payrollActions';

export type BankAccount = { id: string; account_name: string; bank_name: string | null; is_cash_on_hand: boolean };
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const AccountOptions = ({ accounts }: { accounts: BankAccount[] }) => <>{accounts.map((a) => <option key={a.id} value={a.id}>{a.account_name}{a.bank_name ? ` · ${a.bank_name}` : ''}{a.is_cash_on_hand ? ' (cash)' : ''}</option>)}</>;

export function PostPayrollForm({ runId, net, accounts, onDone }: { runId: string; net: number; accounts: BankAccount[]; onDone: (m: string) => void }) {
  const [acc, setAcc] = useState('');
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 text-sm">
      <p>Release the net pay of <b>{peso(net)}</b>. The ledger books it out of the account you choose (Salaries Payable → bank / cash).</p>
      <label className="block">Paid from<select className="input mt-1" value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Select account</option><AccountOptions accounts={accounts} /></select></label>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !acc} onClick={() => start(async () => {
        setError('');
        try { await postPayrollRunAction(runId, acc); onDone('Payroll posted and paid.'); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Posting…' : 'Post (paid)'}</button>
    </div>
  );
}

export function RemitForm({ accounts, onDone }: { accounts: BankAccount[]; onDone: (m: string) => void }) {
  const router = useRouter();
  const [owed, setOwed] = useState<{ code: string; name: string; balance: number }[]>([]);
  const [f, setF] = useState({ code: '2101', amount: '', date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), bank_account_id: '', reference: '' });
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => { payrollLiabilitiesAction().then((x) => setOwed(x as any)).catch((e) => setError(errorText(e))); }, []);
  const cur = owed.find((o) => o.code === f.code);
  return (
    <div className="space-y-3 text-sm">
      <div className="overflow-x-auto rounded border"><table className="w-full text-xs"><tbody>{owed.map((o) => <tr key={o.code} className="border-t first:border-0"><td className="p-2">{o.name}</td><td className="p-2 text-right font-medium">{peso(o.balance)}</td></tr>)}</tbody></table></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">Remitting<select className="input mt-1" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value, amount: '' })}>{owed.map((o) => <option key={o.code} value={o.code}>{o.name}</option>)}</select></label>
        <label className="block">Amount<input className="input mt-1" type="number" step="0.01" placeholder={cur ? String(cur.balance) : ''} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="block">Date paid<input className="input mt-1" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label className="block">Paid from<select className="input mt-1" value={f.bank_account_id} onChange={(e) => setF({ ...f, bank_account_id: e.target.value })}><option value="">Select account</option><AccountOptions accounts={accounts} /></select></label>
        <label className="block sm:col-span-2">Reference (OR / PRN / filing no.)<input className="input mt-1" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending || !f.bank_account_id} onClick={() => start(async () => {
        setError('');
        try {
          const amount = f.amount === '' ? Number(cur?.balance ?? 0) : Number(f.amount);
          await payrollRemitAction({ ...f, amount });
          onDone(`${cur?.name ?? 'Remittance'}: ${peso(amount)} recorded.`); router.refresh();
        } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Record remittance'}</button>
      <p className="text-xs text-slate-500">Only the employees&apos; shares are in payroll today; the employer&apos;s SSS / PhilHealth / Pag-IBIG share is not recorded yet.</p>
    </div>
  );
}
