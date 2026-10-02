// Build 76 (LOG-46) — opening stock counts from the catalog upload: review the
// counted quantities and unit costs, then a Business Admin approves. On
// approval each item's stock at the location is set to the count and the
// starting weighted-average cost is recorded.
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { isAdminTier } from '@/core/auth/types';
import { OpeningCountDecision } from '@/modules/finance/opening-stock/OpeningCountDecision';

export const dynamic = 'force-dynamic';
const peso = (v: unknown) => `₱${Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: unknown) => Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default async function OpeningStockPage() {
  const profile = await requireSection('finance');
  const db = createClient();
  const [{ data: counts, error }, { data: locs }] = await Promise.all([
    db.from('inventory_opening_counts').select('*,prepared:users!inventory_opening_counts_prepared_by_fkey(full_name),decided:users!inventory_opening_counts_decided_by_fkey(full_name)').order('prepared_at', { ascending: false }).limit(50),
    db.rpc('inventory_count_locations'),
  ]);
  if (error) throw new Error(error.message);
  const locName = new Map(((locs ?? []) as any[]).map((l) => [l.id, `${l.location_code} — ${l.location_name}`]));
  const openIds = (counts ?? []).filter((c: any) => c.status === 'prepared').map((c: any) => c.id);
  const { data: lines } = openIds.length
    ? await db.from('inventory_opening_count_lines').select('count_id,counted_qty,unit_cost,item:finance_procurement_items(item_code,item_name,unit)').in('count_id', openIds).limit(5000)
    : { data: [] as any[] };
  const canDecide = isAdminTier(profile);
  return (
    <AuthedShell profile={profile}>
      <div className="space-y-5">
        <div>
          <h2 className="text-xl font-semibold">Opening Stock</h2>
          <p className="mt-1 text-sm text-slate-500">Opening counts come from the OPENING STOCK column of the catalog upload (Finance → Procurement → Catalog → Import CSV). A Business Admin approves each count; the store&apos;s stock is then set to the counted quantities and the starting average cost is recorded.</p>
        </div>
        {(counts ?? []).length === 0 && <div className="rounded border bg-white p-4 text-sm text-slate-500">No opening counts yet.</div>}
        {(counts ?? []).map((c: any) => {
          const ls = ((lines ?? []) as any[]).filter((l) => l.count_id === c.id);
          return (
            <section key={c.id} className="space-y-3 rounded-xl border bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div><span className="font-semibold">{c.count_number}</span> · {locName.get(c.location_id) ?? 'location'} · counted {c.count_date}
                  <div className="text-xs text-slate-500">{c.line_count} item(s) · {qty(c.total_qty)} units · {peso(c.total_value)} · prepared by {c.prepared?.full_name ?? '—'}{c.source ? ` · ${c.source}` : ''}</div></div>
                <span className={`rounded px-2 py-0.5 text-xs capitalize ${c.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : c.status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{c.status === 'prepared' ? 'waiting for approval' : c.status}</span>
              </div>
              {c.status === 'prepared' && (
                <>
                  <div className="max-h-80 overflow-auto rounded border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-xs uppercase text-slate-500"><th className="p-2">Code</th><th className="p-2">Item</th><th className="p-2 text-right">Counted</th><th className="p-2 text-right">Unit cost</th><th className="p-2 text-right">Value</th></tr></thead>
                      <tbody>{ls.map((l, k) => <tr key={k} className="border-t"><td className="p-2">{l.item?.item_code}</td><td className="p-2">{l.item?.item_name}</td><td className="p-2 text-right">{qty(l.counted_qty)} {l.item?.unit}</td><td className="p-2 text-right">{peso(l.unit_cost)}</td><td className="p-2 text-right">{peso(Number(l.counted_qty) * Number(l.unit_cost))}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <OpeningCountDecision countId={c.id} canDecide={canDecide} preparedByMe={c.prepared_by === profile.user.id && profile.user.role !== 'super_admin'} />
                </>
              )}
              {c.status !== 'prepared' && <p className="text-xs text-slate-500">{c.status === 'approved' ? 'Approved' : 'Rejected'} by {c.decided?.full_name ?? '—'} on {String(c.decided_at ?? '').slice(0, 10)}{c.decision_note ? ` — ${c.decision_note}` : ''}</p>}
            </section>
          );
        })}
      </div>
    </AuthedShell>
  );
}
