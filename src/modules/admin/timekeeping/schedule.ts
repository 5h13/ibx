// Build 125 (UIA-40): the work schedule in force for an employee on a date — their own assignment,
// else the store's default schedule (database function employee_schedule_on).
import { appError } from '@/core/errors/appError';

type Db = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

export async function scheduleOn(db: Db, employeeId: string, date: string): Promise<any | null> {
  const { data: id, error } = await db.rpc('employee_schedule_on', { p_employee: employeeId, p_date: date });
  if (error) throw appError(error.message);
  if (!id) return null;
  const { data, error: e } = await db.from('work_schedules').select('*').eq('id', id).maybeSingle();
  if (e) throw appError(e.message);
  return data ?? null;
}
