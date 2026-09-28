import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { AuthedShell } from '@/core/layout/AuthedShell';
import { INTEGRATION_MODULES } from '@/shared/integration/registry';

const COUNT_QUERIES = [
  ['Admin expenses', 'expenses'],
  ['Employees', 'employees'],
  ['Suppliers', 'finance_suppliers'],
  ['Purchase orders', 'purchase_orders'],
  ['Supplier invoices', 'finance_supplier_invoices'],
  ['Customer invoices', 'finance_customer_invoices'],
  ['Payroll runs', 'payroll_runs'],
  ['Inventory items', 'logistics_inventory_items'],
  ['Delivery orders', 'logistics_delivery_orders'],
  ['Marketing campaigns', 'marketing_campaigns'],
  ['Sales orders', 'sales_orders'],
  ['Commissions', 'sales_commissions'],
] as const;

export default async function IntegrationControlCenterPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.role !== 'super_admin') redirect('/dashboard');

  const db = createClient();
  const results = await Promise.all(COUNT_QUERIES.map(async ([label, table]) => {
    const { count } = await db.from(table).select('id', { count: 'exact', head: true });
    return { label, count: count ?? 0 };
  }));

  const [{ data: workflows }, { data: events }, { data: audit }] = await Promise.all([
    db.from('workflow_registry').select('module_name,section_code,workflow_name,states,posting_enabled,active').eq('active', true).order('section_code').order('module_name'),
    db.from('integration_events').select('id,source_module,target_module,event_type,status,message,created_at').order('created_at', { ascending: false }).limit(25),
    db.from('audit_log').select('id,entity_table,action,from_status,to_status,created_at,actor_id').order('created_at', { ascending: false }).limit(20),
  ]);

  const failed = (events ?? []).filter((e: any) => e.status === 'failed').length;
  const pending = (events ?? []).filter((e: any) => e.status === 'pending').length;

  return (
    <AuthedShell profile={profile}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Shared Core / Integration Control Center</h1>
          <p className="mt-1 text-sm text-slate-500">System-wide visibility into module coverage, workflow definitions, cross-module events and the central audit trail.</p>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Active workflows</div><div className="mt-1 text-2xl font-bold">{workflows?.length ?? 0}</div></div>
          <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Recent integration events</div><div className="mt-1 text-2xl font-bold">{events?.length ?? 0}</div></div>
          <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Pending events</div><div className="mt-1 text-2xl font-bold">{pending}</div></div>
          <div className="rounded-xl border bg-white p-4"><div className="text-xs uppercase tracking-wide text-slate-500">Failed events</div><div className="mt-1 text-2xl font-bold">{failed}</div></div>
        </div>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Module coverage</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {INTEGRATION_MODULES.map((m) => <div key={m.code} className="rounded-lg border p-4"><div className="font-medium">{m.label}</div><p className="mt-1 text-xs text-slate-500">{m.description}</p><a className="mt-3 inline-block text-sm text-blue-700 hover:underline" href={m.href}>Open module →</a></div>)}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Operational record counts</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {results.map((r) => <div key={r.label} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{r.label}</div><div className="text-xl font-bold">{r.count.toLocaleString()}</div></div>)}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Workflow registry</h2>
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Section</th><th className="p-2">Module</th><th className="p-2">Workflow</th><th className="p-2">States</th><th className="p-2">Posting</th></tr></thead><tbody>{(workflows ?? []).map((w: any, i) => <tr key={`${w.workflow_name}-${i}`} className="border-t"><td className="p-2 capitalize">{w.section_code}</td><td className="p-2">{w.module_name}</td><td className="p-2 font-medium">{w.workflow_name}</td><td className="p-2 text-xs">{(w.states ?? []).join(' → ')}</td><td className="p-2">{w.posting_enabled ? 'Yes' : 'No'}</td></tr>)}</tbody></table></div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Recent cross-module events</h2>
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Source</th><th className="p-2">Target</th><th className="p-2">Event</th><th className="p-2">Status</th><th className="p-2">Message</th></tr></thead><tbody>{(events ?? []).map((e: any) => <tr key={e.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td><td className="p-2">{e.source_module}</td><td className="p-2">{e.target_module}</td><td className="p-2">{e.event_type}</td><td className="p-2">{e.status}</td><td className="p-2">{e.message || '—'}</td></tr>)}{!(events ?? []).length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">No integration events have been recorded yet.</td></tr>}</tbody></table></div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">Recent audit activity</h2>
          <div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Entity</th><th className="p-2">Action</th><th className="p-2">Status change</th><th className="p-2">Actor</th></tr></thead><tbody>{(audit ?? []).map((a: any) => <tr key={a.id} className="border-t"><td className="p-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td><td className="p-2">{a.entity_table}</td><td className="p-2">{a.action}</td><td className="p-2">{a.from_status || '—'} → {a.to_status || '—'}</td><td className="p-2">{a.actor_id ? String(a.actor_id).slice(0, 8) : '—'}</td></tr>)}</tbody></table></div>
        </section>
      </div>
    </AuthedShell>
  );
}
