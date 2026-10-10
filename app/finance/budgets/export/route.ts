// Build 89a — budget to Excel. One row per line: code, line, type, timing,
// yearly amount, month paid, the 12 months, total, base-year actual, note.
// The same layout is read back by "Import from Excel" (edit the months,
// timing, yearly amount, paid-in month, note; add rows without a code for new
// lines). ?scenario=<id> exports the scenario's figures for viewing.
import { hasAnyFunction, hasFunction } from '@/core/auth/functions';
import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { buildXlsx, type Cell } from '@/shared/export/xlsx';
import { MONTH_LABEL, applyScenario, baseMonths, lineMonths, sum, type BudgetAction, type BudgetLine } from '@/modules/finance/budgets/budgetMath';

const TYPE = { revenue: 'Sales', cogs: 'Cost of sales', expense: 'Expense' } as const;
const TIMING = { monthly: 'Monthly', yearly: 'Yearly', one_time: 'One-time' } as const;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = await getSessionProfile();
  if (!p?.user.is_active || !hasFunction(p, 'finance.budgets') || (!isAdminTier(p) && p.user.role !== 'finance' && !p.access.some((a: any) => a.section_code === 'finance'))) return new NextResponse('Forbidden', { status: 403 });
  const db = createClient();
  const { data: b } = await db.from('finance_budgets').select('*').eq('id', url.searchParams.get('b') ?? '').maybeSingle();
  if (!b) return new NextResponse('Budget not found', { status: 404 });
  const { data: lines } = await db.from('finance_budget_lines').select('*').eq('budget_id', b.id).order('sort_order').order('line_code');
  const L = (lines ?? []) as BudgetLine[];
  const sid = url.searchParams.get('scenario');
  let label = '';
  let values = new Map(L.map((l) => [l.id, lineMonths(l)]));
  if (sid) {
    const [{ data: sc }, { data: acts }] = await Promise.all([db.from('finance_budget_scenarios').select('name').eq('id', sid).maybeSingle(), db.from('finance_budget_actions').select('*').eq('scenario_id', sid)]);
    if (sc) { label = ` - ${sc.name}`; values = applyScenario(L, (acts ?? []) as BudgetAction[]); }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows: Cell[][] = [['Line code', 'Line', 'Type', 'Timing', 'Yearly amount', 'Paid in (month)', ...MONTH_LABEL, 'Total', `${b.base_year ?? 'Base'} actual`, 'Note']];
  for (const l of L) {
    const v = values.get(l.id) ?? Array(12).fill(0);
    rows.push([l.line_code, l.account_name, TYPE[l.line_type], TIMING[l.timing], l.timing === 'yearly' ? r2(sum(v)) : null, l.timing === 'yearly' && l.pay_month ? MONTH_LABEL[l.pay_month - 1] : null,
      ...v.map(r2), r2(sum(v)), r2(sum(baseMonths(l))), l.notes ?? null]);
  }
  const file = buildXlsx(rows, `${b.budget_code}${label}`.slice(0, 31));
  const name = `${b.budget_code}${label.replace(/[^A-Za-z0-9 -]/g, '')}.xlsx`.replace(/\s+/g, '_');
  return new NextResponse(Buffer.from(file), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name}"` } });
}
