// Build 89 (BUD-01) — budget arithmetic shared by the budget screen and the
// server (approval, accruals): a line's 12 months, a scenario's actions applied
// on top, and the profit summary.
export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
export const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export type LineType = 'revenue' | 'cogs' | 'expense';
export type BudgetLine = { id: string; line_code: string; account_name: string; line_type: LineType; line_key: string | null; category_id: string | null; timing: 'monthly' | 'yearly' | 'one_time';
  annual_amount: number | null; pay_month: number | null; base_months: number[] | null; notes: string | null; accrual_schedule_id: string | null; sort_order: number } & Record<string, any>;
export type BudgetAction = { id: string; scenario_id: string; title: string; target: 'line' | 'all_revenue' | 'all_expense'; budget_line_id: string | null; change_kind: 'percent' | 'amount';
  value: number; start_month: number; end_month: number; cogs_follows: boolean; owner: string | null; status: 'planned' | 'in_progress' | 'done' | 'dropped'; notes: string | null; sort_order: number; created_at: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
export const lineMonths = (l: BudgetLine) => MONTHS.map((m) => Number(l[`${m}_budget`] ?? 0));
export const baseMonths = (l: BudgetLine) => (l.base_months ?? []).map(Number).concat(Array(12).fill(0)).slice(0, 12);
export const sum = (a: number[]) => r2(a.reduce((s, v) => s + v, 0));

/** One action applied to a set of values (in place); returns nothing. Dropped actions are skipped. */
function applyAction(values: Map<string, number[]>, lines: BudgetLine[], a: BudgetAction) {
  if (a.status === 'dropped') return;
  const targets = a.target === 'line' ? lines.filter((l) => l.id === a.budget_line_id)
    : a.target === 'all_revenue' ? lines.filter((l) => l.line_type === 'revenue' || (a.cogs_follows && a.change_kind === 'percent' && l.line_type === 'cogs'))
    : lines.filter((l) => l.line_type === 'expense');
  for (const l of targets) {
    const v = values.get(l.id)!;
    for (let m = a.start_month - 1; m <= a.end_month - 1; m++) {
      v[m] = r2(a.change_kind === 'percent' ? v[m] * (1 + Number(a.value) / 100) : v[m] + Number(a.value));
    }
  }
}
export function applyScenario(lines: BudgetLine[], actions: BudgetAction[], upTo = Infinity) {
  const values = new Map(lines.map((l) => [l.id, lineMonths(l)]));
  [...actions].sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at)).slice(0, upTo === Infinity ? undefined : upTo)
    .forEach((a) => applyAction(values, lines, a));
  return values;
}
export type Summary = { sales: number[]; cogs: number[]; gross: number[]; expenses: number[]; net: number[] };
export function summarize(lines: BudgetLine[], values: Map<string, number[]>): Summary {
  const z = () => Array(12).fill(0) as number[];
  const s: Summary = { sales: z(), cogs: z(), gross: z(), expenses: z(), net: z() };
  for (const l of lines) {
    const v = values.get(l.id) ?? z();
    const key = l.line_type === 'revenue' ? 'sales' : l.line_type === 'cogs' ? 'cogs' : 'expenses';
    v.forEach((x, m) => { s[key][m] = r2(s[key][m] + x); });
  }
  for (let m = 0; m < 12; m++) { s.gross[m] = r2(s.sales[m] - s.cogs[m]); s.net[m] = r2(s.gross[m] - s.expenses[m]); }
  return s;
}
/** What each action adds to (or takes from) the year's net income, in order. */
export function actionImpacts(lines: BudgetLine[], actions: BudgetAction[]) {
  const ordered = [...actions].sort((x, y) => x.sort_order - y.sort_order || x.created_at.localeCompare(y.created_at));
  const out: Record<string, number> = {};
  let prev = sum(summarize(lines, applyScenario(lines, ordered, 0)).net);
  ordered.forEach((a, i) => { const now = sum(summarize(lines, applyScenario(lines, ordered, i + 1)).net); out[a.id] = r2(now - prev); prev = now; });
  return out;
}
/** Cash view of a line: yearly items paid in one month. */
export function cashMonths(l: BudgetLine, values: number[]) {
  if (l.timing !== 'yearly' || !l.pay_month) return values;
  const total = sum(values); return values.map((_, m) => (m === l.pay_month! - 1 ? total : 0));
}
