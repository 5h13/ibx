'use client';
// Build 138 — Add store and Copy pricing (Super Admin, System → Businesses).
// A new store gets everything it needs to start (stock location, walk-in customer, books, settings, its house
// agent and an online shop that is switched off) and uses the shared catalog. Prices are per store, so the
// add-ons and markups of another store can be copied at creation or later.
import { useState, useTransition } from 'react';
import { useDialog } from '@/core/ui/Dialog';
import { errorText } from '@/core/errors/appError';
import { addBusinessAction, copyPricingAction } from './actions';

export type StoreRef = { id: string; code: string; name: string };
export type Readiness = {
  logo: boolean; contacts: boolean; location: boolean; receiving_accounts: boolean; pricing: number;
  users: number; business_admin: boolean; stock_items: number; customers: number;
};

export function AddStoreButton({ stores }: { stores: StoreRef[] }) {
  const dialog = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [code, setCode] = useState('');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        const r = await addBusinessAction(fd);
        setOpen(false); setCode('');
        await dialog.alert(`Store ${r.code} added. Next: its logo and colours (Edit), a Business Admin (System → Users), and its receiving bank / e-wallet accounts (Finance → Bank & Cash). Its online shop is /shop/${r.code.toLowerCase()}, switched off until you open it in Sales → Online Shop.`);
      } catch (err) {
        await dialog.alert(errorText(err) || 'The store was not added.', { tone: 'danger' });
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="button">+ Add store</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={submit} className="my-8 w-full max-w-xl space-y-4 rounded bg-white p-6 shadow-lg">
            <div>
              <h2 className="text-lg font-semibold">Add store</h2>
              <p className="text-sm text-slate-500">The store starts with a main stock location, a walk-in customer, its chart of accounts and counter cash / card / check accounts, standard commission brackets, the current month and its own house agent. It sells from the shared catalog.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm">Code
                <input name="code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12))}
                  className="input mt-1 font-mono uppercase" placeholder="e.g. TALA" />
                <span className="mt-0.5 block text-xs text-slate-500">2–12 letters or digits. Cannot be changed later.</span>
              </label>
              <label className="block text-sm sm:col-span-2">Registered (legal) name
                <input name="legal_name" required maxLength={200} className="input mt-1" placeholder="e.g. Tala Trading Corp." />
              </label>
            </div>
            <label className="block text-sm">Store name shown to customers <span className="text-xs text-slate-500">(blank = the legal name)</span>
              <input name="trade_name" maxLength={120} className="input mt-1" placeholder="e.g. TALA AIRCON SUPPLY" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="vat_registered" value="true" /> VAT registered</label>
            <fieldset className="space-y-2 rounded border p-3">
              <legend className="px-1 text-sm font-medium">Contact details <span className="text-xs font-normal text-slate-500">(printed on DRs and quotations; can be added later)</span></legend>
              <label className="block text-sm">Address<textarea name="address" maxLength={300} rows={2} className="input mt-1" placeholder="Street, barangay, city, province" /></label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">Phone<input name="phone" maxLength={80} className="input mt-1" /></label>
                <label className="block text-sm">Email<input name="email" type="email" maxLength={120} className="input mt-1" /></label>
              </div>
            </fieldset>
            <label className="block text-sm">Prices: copy category add-ons and item markups from
              <select name="copy_pricing_from" defaultValue={stores[0]?.id ?? ''} className="input mt-1">
                <option value="">Don&apos;t copy (prices will equal cost until set)</option>
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
              <span className="mt-0.5 block text-xs text-slate-500">Finance can change them afterwards in the store&apos;s pricing.</span>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button type="submit" disabled={busy} className="button">{busy ? 'Adding…' : 'Add store'}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function CopyPricingButton({ target, stores }: { target: StoreRef; stores: StoreRef[] }) {
  const dialog = useDialog();
  const others = stores.filter((s) => s.id !== target.id);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(others[0]?.id ?? '');
  const [overwrite, setOverwrite] = useState(false);
  const [busy, start] = useTransition();

  function run() {
    const src = others.find((s) => s.id === from);
    if (!src) return;
    start(async () => {
      if (overwrite && !(await dialog.confirm(`Replace ${target.name}'s add-ons and markups with ${src.name}'s wherever both have one?`, { confirmLabel: 'Replace', tone: 'danger' }))) return;
      try {
        const r = await copyPricingAction(src.id, target.id, overwrite);
        setOpen(false);
        await dialog.alert(`${r.categories} category add-on${r.categories === 1 ? '' : 's'} and ${r.items} item markup${r.items === 1 ? '' : 's'} ${overwrite ? 'copied or replaced' : 'copied'} from ${src.name}.`);
      } catch (err) {
        await dialog.alert(errorText(err) || 'Pricing was not copied.', { tone: 'danger' });
      }
    });
  }

  if (others.length === 0) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded border px-2 py-1 text-xs">Copy pricing</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="my-16 w-full max-w-md space-y-4 rounded bg-white p-6 shadow-lg">
            <h2 className="text-lg font-semibold">Copy pricing to {target.name}</h2>
            <label className="block text-sm">Copy category add-ons and item markups from
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="input mt-1">
                {others.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
              </select>
            </label>
            <fieldset className="space-y-1.5 text-sm">
              <label className="flex items-start gap-2"><input type="radio" checked={!overwrite} onChange={() => setOverwrite(false)} className="mt-1" />
                <span>Only fill in what {target.name} doesn&apos;t have yet <span className="block text-xs text-slate-500">Its own add-ons and markups stay as they are.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" checked={overwrite} onChange={() => setOverwrite(true)} className="mt-1" />
                <span>Replace with the other store&apos;s <span className="block text-xs text-slate-500">Where both stores have one, the other store&apos;s value wins.</span></span></label>
            </fieldset>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded border px-3 py-2 text-sm">Cancel</button>
              <button type="button" onClick={run} disabled={busy || !from} className="button">{busy ? 'Copying…' : 'Copy pricing'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const CHECKS: { key: keyof Readiness; label: string; ok: (r: Readiness) => boolean }[] = [
  { key: 'business_admin', label: 'Business Admin', ok: (r) => r.business_admin },
  { key: 'pricing', label: 'Pricing', ok: (r) => r.pricing > 0 },
  { key: 'receiving_accounts', label: 'Bank / e-wallet', ok: (r) => r.receiving_accounts },
  { key: 'logo', label: 'Logo', ok: (r) => r.logo },
  { key: 'contacts', label: 'Address & phone', ok: (r) => r.contacts },
];

export function ReadinessChips({ r }: { r: Readiness | null }) {
  if (!r) return <span className="text-slate-400">—</span>;
  const missing = CHECKS.filter((c) => !c.ok(r));
  if (missing.length === 0) return <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Ready</span>;
  return (
    <div className="flex max-w-[14rem] flex-wrap gap-1">
      {missing.map((c) => <span key={c.key} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">No {c.label.toLowerCase()}</span>)}
    </div>
  );
}
