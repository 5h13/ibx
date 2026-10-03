// Build 80 (EXP-01): data for a department's expense page — its own
// expenses for the chosen month (?month=YYYY-MM, default this month).
import { createClient } from '@/core/auth/supabaseServer';
import { getMonthId } from '@/core/utils/currentMonth';
import type { SectionCode, SessionProfile } from '@/core/auth/types';

export type DeptExpenseData = Awaited<ReturnType<typeof loadDepartmentExpenses>>;

export async function loadDepartmentExpenses(profile: SessionProfile, section: SectionCode, monthParam?: string) {
  const db = createClient();
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth() + 1;
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam || '');
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) { year = Number(m[1]); month = Number(m[2]); }
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const [{ data: sec }, monthId] = await Promise.all([
    db.from('sections').select('id').eq('code', section).single(),
    profile.user.business_id ? getMonthId(profile.user.business_id, year, month, false) : Promise.resolve(null),
  ]);

  const rowsQuery = monthId && sec
    ? db.from('expenses')
        .select('*,category:admin_expense_categories(id,name),asset:assets(asset_no,name),vehicle:fleet_vehicles(vehicle_no,plate_no),documents:finance_expense_documents(id,document_name,created_at)')
        .eq('section_id', sec.id).eq('month_id', monthId)
        .order('expense_date', { ascending: false }).order('created_at', { ascending: false })
    : null;

  const [rowsRes, { data: categories }, { data: costCenters }, { data: suppliers }, { data: assets }, { data: vehicles }, { data: recent }] = await Promise.all([
    rowsQuery ?? Promise.resolve({ data: [] as any[], error: null }),
    db.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name'),
    db.from('finance_cost_centers').select('id,code,name').eq('active', true).order('name'),
    db.from('finance_suppliers').select('id,supplier_code,legal_name').eq('active', true).order('legal_name'),
    db.from('assets').select('id,asset_no,name').order('asset_no'),
    db.from('fleet_vehicles').select('id,vehicle_no,plate_no').order('vehicle_no'),
    sec ? db.from('expenses').select('description').eq('section_id', sec.id).order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [] as any[] }),
  ]);
  if ((rowsRes as any).error) throw new Error((rowsRes as any).error.message);

  const suggestions = Array.from(new Set(((recent ?? []) as any[]).map((r) => String(r.description || '').trim()).filter(Boolean))).slice(0, 50);
  return {
    section, sectionId: sec?.id ?? '', monthKey, monthLabel,
    rows: ((rowsRes as any).data ?? []) as any[],
    categories: categories ?? [], costCenters: costCenters ?? [], suppliers: suppliers ?? [],
    assets: assets ?? [], vehicles: vehicles ?? [], suggestions,
  };
}
