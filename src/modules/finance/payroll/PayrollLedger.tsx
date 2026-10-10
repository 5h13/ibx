'use client';
// Build 100 — payroll in the ledger: "Post (paid)" asks which bank / cash account the net pay left from;
// "Remit" pays SSS / PhilHealth / Pag-IBIG / withholding tax (or other deductions) out of their payables.
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { errorText } from '@/core/errors/appError';
import { payrollLiabilitiesAction, payrollRemitAction, postPayrollRunAction, payrollContributionSettingsAction, savePayrollContributionSettingsAction } from '@/modules/finance/payrollActions';

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
      <p className="text-xs text-slate-500">Balances include both the employees&apos; and the employer&apos;s SSS (with EC) / PhilHealth / Pag-IBIG shares.</p>
    </div>
  );
}

// Build 101 — the store's SSS / EC / PhilHealth / Pag-IBIG rates (defaults: 2025 schedules — confirm with the accountant)
const RATE_FIELDS: [string, string, [string, string][]][] = [
  ['SSS', 'Monthly salary credit (MSC): pay rounded to the step, kept between the minimum and maximum.', [['sss_ee_pct', 'Employee % of MSC'], ['sss_er_pct', 'Employer % of MSC'], ['sss_msc_min', 'MSC minimum ₱'], ['sss_msc_max', 'MSC maximum ₱'], ['sss_msc_step', 'MSC step ₱']]],
  ['EC (employer only)', '', [['sss_ec_low', 'EC below threshold ₱'], ['sss_ec_high', 'EC from threshold ₱'], ['sss_ec_threshold', 'Threshold MSC ₱']]],
  ['PhilHealth', 'Premium on basic monthly pay (between floor and ceiling), shared equally.', [['ph_pct', 'Premium %'], ['ph_floor', 'Floor ₱'], ['ph_ceiling', 'Ceiling ₱']]],
  ['Pag-IBIG', '', [['hdmf_ee_pct', 'Employee %'], ['hdmf_er_pct', 'Employer %'], ['hdmf_cap', 'Pay cap ₱'], ['hdmf_low_ee_pct', 'Employee % at low pay'], ['hdmf_low_threshold', 'Low pay up to ₱']]],
];
export function ContributionRatesForm({ onDone }: { onDone: (m: string) => void }) {
  const [v, setV] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => { payrollContributionSettingsAction().then((x) => { if (!x) setError('Select a business in "Acting as" first.'); setV(x); }).catch((e) => setError(errorText(e))); }, []);
  if (!v) return <p className="text-sm">{error || 'Loading…'}</p>;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-xs text-amber-700">Defaults follow the 2025 SSS, PhilHealth and Pag-IBIG schedules. Have your accountant confirm them; changes apply to runs computed after saving.</p>
      {RATE_FIELDS.map(([title, note, fields]) => <fieldset key={title} className="rounded border p-3"><legend className="px-1 font-semibold">{title}</legend>{note && <p className="mb-2 text-xs text-slate-500">{note}</p>}
        <div className="grid gap-2 sm:grid-cols-3">{fields.map(([k, l]) => <label key={k} className="block text-xs">{l}<input className="input mt-1" type="number" step="0.01" min="0" value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value as any })} /></label>)}</div></fieldset>)}
      {error && <p className="text-red-700">{error}</p>}
      <button type="button" className="button" disabled={pending} onClick={() => start(async () => {
        setError('');
        try { const p: Record<string, number> = {}; RATE_FIELDS.forEach(([, , fs]) => fs.forEach(([k]) => { if (v[k] !== ('' as any) && v[k] != null) p[k] = Number(v[k]); })); await savePayrollContributionSettingsAction(p); onDone('Contribution rates saved.'); } catch (e) { setError(errorText(e)); }
      })}>{pending ? 'Saving…' : 'Save rates'}</button>
    </div>
  );
}
