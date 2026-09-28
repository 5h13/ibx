// app/finance/dashboard/page.tsx
//
// U056 — Finance Executive Dashboard. Prior to this build, Finance had no
// cross-module summary at all: every finance submodule (AP, AR, Bank/Cash,
// Budgets) had its own siloed "overview" tab, and there was no single view
// of cash position, payables/receivables aging, period expenses, and budget
// vs actual together. This page adds that view without duplicating each
// submodule's own workflow UI — it's read-only, and every figure is scoped
// by the same RLS/business_id rules the source tables already enforce
// (has_section_access('finance') plus the business isolation policies).
import { requireSection } from '@/core/auth/requireSection';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { getCurrentMonthId } from '@/core/utils/currentMonth';

const peso = (n: number) => `₱${Number(n || 0).toLocaleString()}`;

type AgingBuckets = { current: number; d30: number; d60: number; d90: number; d90p: number };

function aging(rows: Array<{ balance_due: number | null; due_date: string | null }>): AgingBuckets {
  const today = new Date();
  return rows.reduce(
    (a, r) => {
      const balance = Number(r.balance_due || 0);
      if (balance <= 0) return a;
      const d = r.due_date ? new Date(`${r.due_date}T00:00:00`) : today;
      const days = Math.floor((today.getTime() - d.getTime()) / 86400000);
      if (days <= 0) a.current += balance;
      else if (days <= 30) a.d30 += balance;
      else if (days <= 60) a.d60 += balance;
      else if (days <= 90) a.d90 += balance;
      else a.d90p += balance;
      return a;
    },
    { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 }
  );
}

const MONTH_COLS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].map((m) => `${m}_budget`);

export default async function FinanceDashboardPage() {
  const profile = await requireSection('finance');
  const db = createClient();

  // U002's fix (business-scoped `months`) is the shared prerequisite this
  // dashboard needs for "expenses this month" to resolve correctly.
  const monthId = await getCurrentMonthId(profile.user.business_id);
  const fiscalYear = new Date().getFullYear();

  const [
    { data: bankAccounts, error: e1 },
    { data: apInvoices, error: e2 },
    { data: arInvoices, error: e3 },
    { data: expenseRows, error: e4 },
    { data: budgets, error: e5 },
  ] = await Promise.all([
    db.from('finance_bank_accounts').select('id,account_code,account_name,current_balance').eq('status', 'active').order('account_code'),
    db.from('finance_supplier_invoices').select('balance_due,due_date').in('status', ['approved', 'partially_paid']),
    db.from('finance_customer_invoices').select('balance_due,due_date').in('status', ['approved', 'partially_paid']),
    db.from('expenses').select('amount,section:sections(name)').eq('month_id', monthId),
    db.from('finance_budgets').select('id,budget_code,name,fiscal_year,scenario,status').eq('fiscal_year', fiscalYear).eq('scenario', 'budget').order('version', { ascending: false }),
  ]);

  const err = e1 || e2 || e3 || e4 || e5;
  if (err) throw new Error(err.message);

  const cash = (bankAccounts ?? []).reduce((s, a) => s + Number(a.current_balance || 0), 0);
  const apAging = aging(apInvoices ?? []);
  const arAging = aging(arInvoices ?? []);
  const apOutstanding = apAging.current + apAging.d30 + apAging.d60 + apAging.d90 + apAging.d90p;
  const arOutstanding = arAging.current + arAging.d30 + arAging.d60 + arAging.d90 + arAging.d90p;

  const expenseBySection = new Map<string, number>();
  for (const row of expenseRows ?? []) {
    const label = (row as any).section?.name || 'Unassigned';
    expenseBySection.set(label, (expenseBySection.get(label) || 0) + Number(row.amount || 0));
  }
  const totalExpensesThisMonth = Array.from(expenseBySection.values()).reduce((s, v) => s + v, 0);

  const activeBudget = (budgets ?? []).find((b) => b.status === 'approved') ?? (budgets ?? [])[0] ?? null;
  let budgetTotal = 0;
  let actualTotal = 0;
  if (activeBudget) {
    const [{ data: lines }, { data: actuals }] = await Promise.all([
      db.from('finance_budget_lines').select(`id,${MONTH_COLS.join(',')}`).eq('budget_id', activeBudget.id),
      db.from('finance_budget_actuals').select('budget_line_id,actual_amount').eq('fiscal_year', fiscalYear),
    ]);
    const lineIds = new Set((lines ?? []).map((l: any) => l.id));
    budgetTotal = (lines ?? []).reduce((s, l: any) => s + MONTH_COLS.reduce((x, c) => x + Number(l[c] || 0), 0), 0);
    actualTotal = (actuals ?? []).filter((a: any) => lineIds.has(a.budget_line_id)).reduce((s, a: any) => s + Number(a.actual_amount || 0), 0);
  }

  const cards = [
    { label: 'Cash Position', value: peso(cash) },
    { label: 'AP Outstanding', value: peso(apOutstanding) },
    { label: 'AR Outstanding', value: peso(arOutstanding) },
    { label: 'Expenses (this month)', value: peso(totalExpensesThisMonth) },
  ];

  const agingBuckets = (a: AgingBuckets): Array<[string, number]> => [
    ['Current', a.current],
    ['1–30 days', a.d30],
    ['31–60 days', a.d60],
    ['61–90 days', a.d90],
    ['90+ days', a.d90p],
  ];

  return (
    <AuthedShell profile={profile}>
      <h2 className="text-lg font-semibold mb-1">Finance Dashboard</h2>
      <p className="text-sm text-slate-500 mb-4">
        Cash position, payables/receivables aging, period expenses and budget vs actual.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow-sm p-4">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className="text-xl font-bold text-slate-900">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold mb-3">Cash by account</h3>
          <div className="space-y-2 text-sm">
            {(bankAccounts ?? []).map((a) => (
              <div key={a.id} className="flex justify-between border-b last:border-0 pb-1">
                <span>{a.account_code} — {a.account_name}</span>
                <span className="font-medium">{peso(a.current_balance)}</span>
              </div>
            ))}
            {(bankAccounts ?? []).length === 0 && <p className="text-slate-400">No active bank/cash accounts.</p>}
          </div>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold mb-3">Expenses by section (this month)</h3>
          <div className="space-y-2 text-sm">
            {Array.from(expenseBySection.entries()).map(([label, amt]) => (
              <div key={label} className="flex justify-between border-b last:border-0 pb-1">
                <span>{label}</span>
                <span className="font-medium">{peso(amt)}</span>
              </div>
            ))}
            {expenseBySection.size === 0 && <p className="text-slate-400">No expenses recorded for this month.</p>}
          </div>
        </section>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold mb-3">AP aging</h3>
          <div className="grid grid-cols-5 gap-2 text-xs">
            {agingBuckets(apAging).map(([label, v]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2">
                <div className="text-slate-500">{label}</div>
                <div className="font-semibold">{peso(v)}</div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-xl border bg-white p-4">
          <h3 className="font-semibold mb-3">AR aging</h3>
          <div className="grid grid-cols-5 gap-2 text-xs">
            {agingBuckets(arAging).map(([label, v]) => (
              <div key={label} className="rounded-lg bg-slate-50 p-2">
                <div className="text-slate-500">{label}</div>
                <div className="font-semibold">{peso(v)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-xl border bg-white p-4">
        <h3 className="font-semibold mb-3">
          Budget vs actual{activeBudget ? ` — ${activeBudget.budget_code} (FY${activeBudget.fiscal_year})` : ''}
        </h3>
        {activeBudget ? (
          <div className="grid md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-500">Full-year budget</p>
              <p className="text-lg font-semibold">{peso(budgetTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Actual to date</p>
              <p className="text-lg font-semibold">{peso(actualTotal)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Variance</p>
              <p className="text-lg font-semibold">{peso(budgetTotal - actualTotal)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No FY{fiscalYear} budget found.</p>
        )}
      </section>
    </AuthedShell>
  );
}
