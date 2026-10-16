'use server';
// Build 120 — My Profile as the staff home: clock in / break / clock out, my leave, my timekeeping.
//
// Staff have no RLS access to their own employee row, schedules, leave types or balances (only the
// Admin section does), so — as in selfServiceActions.ts (U011) and app/profile/page.tsx — these
// self-service reads and writes use the service-role client, ALWAYS keyed to the caller's own
// employee record resolved here from the session (never an id sent by the browser). Every write
// is limited to that employee's own attendance / leave / correction rows, and the time stamped is
// the server's clock, not the device's.
import { revalidatePath } from 'next/cache';
import { appError } from '@/core/errors/appError';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { notifyUsers } from '@/shared/notifications/service';
import { calculateAttendance, localDateFor } from '@/modules/admin/timekeeping/calculator';

const TZ = 'Asia/Manila';
const SPECIAL = ['absent', 'half_day', 'leave', 'holiday', 'rest_day', 'official_business', 'work_from_home'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

type Db = ReturnType<typeof createAdminClient>;
export type ClockStep = 'in' | 'break_out' | 'break_in' | 'out';

async function me() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  const db = createAdminClient();
  const { data: employee, error } = await db.from('employees')
    .select('id,business_id,user_id,first_name,last_name,preferred_name,employment_status')
    .eq('user_id', profile.user.id).maybeSingle();
  if (error) throw appError(error.message);
  if (!employee) throw appError('Your account is not linked to an employee record. Ask your Business Admin to link it.');
  return { profile, db, employee: employee as any };
}

async function scheduleFor(db: Db, employeeId: string, date: string) {
  const { data: a } = await db.from('employee_schedule_assignments').select('schedule_id')
    .eq('employee_id', employeeId).lte('effective_from', date).or(`effective_to.is.null,effective_to.gte.${date}`)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (!a) return null;
  const { data: s } = await db.from('work_schedules').select('*').eq('id', (a as any).schedule_id).maybeSingle();
  return (s as any) ?? null;
}

function scheduleText(s: any, date: string) {
  if (!s) return null;
  const [y, m, d] = date.split('-').map(Number);
  const k = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const t = (v: string | null) => (v ? String(v).slice(0, 5) : null);
  if (!s[`${k}_in`] || !s[`${k}_out`]) return { name: s.name, text: 'Rest day', rest: true };
  const br = s[`${k}_break_start`] && s[`${k}_break_end`] ? `, break ${t(s[`${k}_break_start`])}–${t(s[`${k}_break_end`])}` : '';
  return { name: s.name, text: `${t(s[`${k}_in`])}–${t(s[`${k}_out`])}${br}${s.grace_minutes ? ` (${s.grace_minutes} min grace)` : ''}`, rest: false };
}

async function lockedPeriod(db: Db, periodId: string | null) {
  if (!periodId) return false;
  const { data } = await db.from('attendance_periods').select('status').eq('id', periodId).maybeSingle();
  return (data as any)?.status === 'locked';
}

async function audit(db: Db, actor: string, table: string, id: string, action: string, detail: Record<string, unknown>) {
  await db.from('audit_log').insert({ actor_id: actor, entity_table: table, entity_id: id, action, detail });
}

/** HR reviewers / approvers of the store and its Business Admins (best effort, never blocks the request). */
async function tellHr(db: Db, businessId: string, payload: { title: string; message?: string; entity_table: string; entity_id: string; action_url: string }) {
  try {
    const { data: section } = await db.from('sections').select('id').eq('code', 'admin').maybeSingle();
    const ids = new Set<string>();
    if (section) {
      const { data: rows } = await db.from('user_access').select('user_id,workflow_role,user:users!inner(is_active,business_id)')
        .eq('section_id', (section as any).id).in('workflow_role', ['reviewer', 'approver']);
      for (const r of (rows ?? []) as any[]) if (r.user?.is_active && r.user?.business_id === businessId) ids.add(r.user_id);
    }
    const { data: bas } = await db.from('users').select('id').eq('business_id', businessId).eq('role', 'business_admin').eq('is_active', true);
    for (const u of (bas ?? []) as any[]) ids.add(u.id);
    if (ids.size) await notifyUsers([...ids], businessId, { ...payload, section_code: 'admin' });
  } catch { /* notifications are best effort */ }
}

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-PH', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }) : null);

// ------------------------------------------------------------------ clock --
export async function myClockAction(step: ClockStep) {
  const { profile, db, employee } = await me();
  if (!['in', 'break_out', 'break_in', 'out'].includes(step)) throw appError('Unknown clock step.');
  const now = new Date();
  const date = localDateFor(now, TZ);
  const schedule = await scheduleFor(db, employee.id, date);
  const { data: rec, error } = await db.from('attendance_records').select('*').eq('employee_id', employee.id).eq('attendance_date', date).maybeSingle();
  if (error) throw appError(error.message);
  const r: any = rec;
  if (r && (await lockedPeriod(db, r.period_id))) throw appError('Today\'s attendance is in a locked period; ask your admin.');
  const stamp = now.toISOString();

  if (step === 'in') {
    if (r?.time_in) throw appError(`You already clocked in today at ${fmtTime(r.time_in)}.`);
    if (r && ['leave', 'holiday', 'rest_day'].includes(r.status)) {
      throw appError(`Today is marked "${String(r.status).replace('_', ' ')}" on your attendance. Ask your admin if you are working today.`);
    }
    const values: any = { employee_id: employee.id, business_id: employee.business_id, attendance_date: date, time_in: stamp, schedule_id: schedule?.id ?? null, prepared_by: profile.user.id };
    const calc = schedule ? calculateAttendance({ attendanceDate: date, schedule, timeIn: stamp, breakOut: null, breakIn: null, timeOut: null })
                          : { regular_hours: 0, overtime_hours: 0, late_minutes: 0, undertime_minutes: 0, status: 'present' as const };
    Object.assign(values, calc, { status: calc.status === 'incomplete' ? 'present' : calc.status });
    const q = r ? db.from('attendance_records').update({ ...values, updated_at: stamp }).eq('id', r.id).select('id').single()
                : db.from('attendance_records').insert(values).select('id').single();
    const { data, error: e } = await q;
    if (e || !data) throw appError(e?.message || 'Unable to clock in.');
    await audit(db, profile.user.id, 'attendance_records', (data as any).id, 'created', { action: 'clock_in', self: true, late_minutes: calc.late_minutes });
  } else {
    if (!r?.time_in) throw appError('You have not clocked in today.');
    if (r.time_out) throw appError(`You already clocked out today at ${fmtTime(r.time_out)}.`);
    const patch: any = {};
    if (step === 'break_out') {
      if (r.break_out) throw appError('Your break was already started today (one break a day is recorded).');
      patch.break_out = stamp;
    } else if (step === 'break_in') {
      if (!r.break_out) throw appError('You have not started a break.');
      if (r.break_in) throw appError('Your break already ended.');
      patch.break_in = stamp;
    } else {
      if (r.break_out && !r.break_in) throw appError('End your break first, then clock out.');
      patch.time_out = stamp;
    }
    const merged = { ...r, ...patch };
    const sched = r.schedule_id ? ((await db.from('work_schedules').select('*').eq('id', r.schedule_id).maybeSingle()).data as any) : schedule;
    if (sched) {
      const calc = calculateAttendance({ attendanceDate: r.attendance_date, schedule: sched, timeIn: merged.time_in, breakOut: merged.break_out, breakIn: merged.break_in, timeOut: merged.time_out });
      Object.assign(patch, calc, { schedule_id: sched.id, status: SPECIAL.includes(r.status) ? r.status : step === 'out' ? calc.status : r.status });
    }
    patch.updated_at = stamp;
    const { error: e } = await db.from('attendance_records').update(patch).eq('id', r.id).eq('employee_id', employee.id);
    if (e) throw appError(e.message);
    await audit(db, profile.user.id, 'attendance_records', r.id, 'edited', { action: `clock_${step}`, self: true });
  }
  revalidatePath('/profile');
  return { ok: true, at: fmtTime(stamp) };
}

// ------------------------------------------------------------------ leave --
function daysOf(start: string, end: string, dayType: string) {
  const n = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
  return dayType === 'full_day' ? n : n === 1 ? 0.5 : n - 0.5;
}

export async function myLeaveRequestAction(input: { leave_type_id: string; start_date: string; end_date: string; day_type: string; reason: string }) {
  const { profile, db, employee } = await me();
  const { leave_type_id, start_date, end_date, day_type } = input;
  const reason = String(input.reason ?? '').trim();
  if (!leave_type_id) throw appError('Choose the type of leave.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end_date || '')) throw appError('Enter the first and last day of the leave.');
  if (end_date < start_date) throw appError('The last day cannot be before the first day.');
  if (!['full_day', 'first_half', 'second_half'].includes(day_type)) throw appError('Choose whole day or half day.');
  if (!reason) throw appError('Give a reason for the leave.');
  const days = daysOf(start_date, end_date, day_type);
  if (days <= 0) throw appError('The leave must be at least half a day.');
  if (days > 60) throw appError('A single request can be at most 60 days; file longer leave in parts.');
  const { data: type } = await db.from('leave_types').select('id,name,active').eq('id', leave_type_id).maybeSingle();
  if (!type || !(type as any).active) throw appError('That leave type is not available.');
  const { data: overlap } = await db.from('leave_requests').select('id,start_date,end_date,status').eq('employee_id', employee.id)
    .in('status', ['prepared', 'reviewed', 'approved']).lte('start_date', end_date).gte('end_date', start_date).limit(1);
  if (overlap?.length) throw appError(`You already have a ${(overlap[0] as any).status === 'approved' ? 'approved' : 'pending'} leave from ${(overlap[0] as any).start_date} to ${(overlap[0] as any).end_date} on those days.`);
  const { data, error } = await db.from('leave_requests').insert({
    business_id: employee.business_id, employee_id: employee.id, leave_type_id, start_date, end_date, day_type, days, reason, status: 'prepared', requested_by: profile.user.id,
  }).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to file the leave.');
  await audit(db, profile.user.id, 'leave_requests', (data as any).id, 'submitted', { self: true, start_date, end_date, days });
  const who = profile.user.nickname || profile.user.full_name || 'An employee';
  await tellHr(db, employee.business_id, { title: 'Leave request needs review', message: `${who}: ${(type as any).name}, ${start_date}${end_date !== start_date ? ` to ${end_date}` : ''} (${days} day${days === 1 ? '' : 's'}) — ${reason}`, entity_table: 'leave_requests', entity_id: (data as any).id, action_url: '/admin/leave' });
  revalidatePath('/profile');
  return { ok: true, days };
}

export async function myLeaveCancelAction(id: string) {
  const { profile, db, employee } = await me();
  const { data: req } = await db.from('leave_requests').select('id,employee_id,status').eq('id', id).maybeSingle();
  if (!req || (req as any).employee_id !== employee.id) throw appError('Leave request not found.');
  if (!['prepared', 'reviewed'].includes((req as any).status)) throw appError('Only a leave that is still waiting can be cancelled; ask your admin for an approved one.');
  const { error } = await db.from('leave_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).eq('employee_id', employee.id);
  if (error) throw appError(error.message);
  await audit(db, profile.user.id, 'leave_requests', id, 'cancelled', { self: true });
  revalidatePath('/profile');
  return { ok: true };
}

// ------------------------------------------------------------- correction --
/** "HH:MM" on a Manila date → ISO; a time earlier than the clock-in on a night shift is the next day. */
function at(date: string, hhmm: string | null | undefined, after?: string | null) {
  if (!hhmm) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) throw appError(`"${hhmm}" is not a time.`);
  let t = new Date(`${date}T${hhmm}:00+08:00`);
  if (after && t.getTime() < new Date(after).getTime()) t = new Date(t.getTime() + 86400000);
  return t.toISOString();
}

export async function myCorrectionAction(input: { date: string; time_in?: string; break_out?: string; break_in?: string; time_out?: string; reason: string }) {
  const { profile, db, employee } = await me();
  const date = String(input.date ?? '');
  const reason = String(input.reason ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw appError('Choose the day to correct.');
  if (date > localDateFor(new Date(), TZ)) throw appError('You can only correct today or an earlier day.');
  if (!reason) throw appError('Say what happened (e.g. "forgot to clock out").');
  const tin = at(date, input.time_in);
  const bout = at(date, input.break_out, tin);
  const bin = at(date, input.break_in, bout ?? tin);
  const tout = at(date, input.time_out, bin ?? bout ?? tin);
  if (!tin && !tout && !bout && !bin) throw appError('Enter at least one corrected time.');
  if (tin && tout && tout <= tin) throw appError('The clock-out must be after the clock-in.');
  let { data: rec } = await db.from('attendance_records').select('id,period_id,time_in,break_out,break_in,time_out').eq('employee_id', employee.id).eq('attendance_date', date).maybeSingle();
  if (rec && (await lockedPeriod(db, (rec as any).period_id))) throw appError('That day is in a locked attendance period; ask your admin.');
  if (!rec) {
    // a forgotten clock-in: an empty day record is created for the correction to attach to
    const { data, error } = await db.from('attendance_records').insert({ business_id: employee.business_id, employee_id: employee.id, attendance_date: date, status: 'incomplete', notes: 'Created for a correction request', prepared_by: profile.user.id }).select('id,period_id,time_in,break_out,break_in,time_out').single();
    if (error || !data) throw appError(error?.message || 'Unable to start the correction.');
    rec = data;
  }
  const r: any = rec;
  const { data: open } = await db.from('attendance_corrections').select('id').eq('attendance_id', r.id).in('status', ['draft', 'prepared', 'reviewed']).limit(1);
  if (open?.length) throw appError('A correction for that day is already waiting for review.');
  const { data, error } = await db.from('attendance_corrections').insert({
    business_id: employee.business_id, attendance_id: r.id, requested_by: profile.user.id, reason,
    // times left blank keep what is recorded (the approval copies all four times onto the day)
    requested_time_in: tin ?? r.time_in, requested_break_out: bout ?? r.break_out, requested_break_in: bin ?? r.break_in, requested_time_out: tout ?? r.time_out,
  }).select('id').single();
  if (error || !data) throw appError(error?.message || 'Unable to send the correction.');
  await audit(db, profile.user.id, 'attendance_corrections', (data as any).id, 'submitted', { self: true, date });
  const who = profile.user.nickname || profile.user.full_name || 'An employee';
  await tellHr(db, employee.business_id, { title: 'Attendance correction needs review', message: `${who}, ${date}: ${reason}`, entity_table: 'attendance_corrections', entity_id: (data as any).id, action_url: '/admin/timekeeping' });
  revalidatePath('/profile');
  return { ok: true };
}

// ------------------------------------------------------------------- read --
export type MyTimeData = Awaited<ReturnType<typeof loadMyTime>>;

/** Everything the My Profile time panel shows. `range`: 'p:<period id>' or 'm:YYYY-MM' (default: the period holding today, else this month). */
export async function loadMyTime(userId: string, range?: string | null) {
  const db = createAdminClient();
  const { data: employee } = await db.from('employees').select('id,business_id').eq('user_id', userId).maybeSingle();
  if (!employee) return null;
  const e: any = employee;
  const today = localDateFor(new Date(), TZ);
  const year = Number(today.slice(0, 4));

  const [{ data: rec }, schedule, { data: periods }, { data: types }, { data: balances }, { data: requests }] = await Promise.all([
    db.from('attendance_records').select('id,attendance_date,time_in,break_out,break_in,time_out,status,late_minutes,undertime_minutes,regular_hours,overtime_hours').eq('employee_id', e.id).eq('attendance_date', today).maybeSingle(),
    scheduleFor(db, e.id, today),
    db.from('attendance_periods').select('id,name,start_date,end_date,status').eq('business_id', e.business_id).order('start_date', { ascending: false }).limit(8),
    db.from('leave_types').select('id,code,name,paid,default_days_per_year').eq('active', true).order('name'),
    db.from('employee_leave_balances').select('leave_type_id,entitlement,used,adjustment').eq('employee_id', e.id).eq('leave_year', year),
    db.from('leave_requests').select('id,leave_type_id,start_date,end_date,day_type,days,reason,status,rejection_reason,created_at').eq('employee_id', e.id).order('start_date', { ascending: false }).limit(20),
  ]);

  // the range shown in "My timekeeping"
  const months: { key: string; label: string; start: string; end: string }[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 1 - i, 1));
    const s = d.toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    months.push({ key: `m:${s.slice(0, 7)}`, label: d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }), start: s, end });
  }
  const per = ((periods ?? []) as any[]).map((p) => ({ key: `p:${p.id}`, label: `${p.name} (${p.start_date} – ${p.end_date})${p.status === 'locked' ? ' · locked' : ''}`, start: p.start_date, end: p.end_date, holdsToday: p.start_date <= today && p.end_date >= today }));
  const choices = [...per, ...months];
  const chosen = choices.find((c) => c.key === range) ?? per.find((p) => p.holdsToday) ?? months[0];

  const [{ data: days }, { data: corrections }] = await Promise.all([
    db.from('attendance_records').select('id,attendance_date,time_in,break_out,break_in,time_out,status,late_minutes,undertime_minutes,regular_hours,overtime_hours,notes')
      .eq('employee_id', e.id).gte('attendance_date', chosen.start).lte('attendance_date', chosen.end).order('attendance_date', { ascending: false }),
    db.from('attendance_corrections').select('id,attendance_id,reason,status,rejection_reason,created_at,attendance:attendance_records!inner(attendance_date,employee_id)')
      .eq('requested_by', userId).eq('attendance.employee_id', e.id).order('created_at', { ascending: false }).limit(15),
  ]);
  const list = (days ?? []) as any[];
  const worked = list.filter((d) => d.time_in);
  const totals = {
    days_worked: worked.length,
    late_days: list.filter((d) => Number(d.late_minutes) > 0).length,
    late_minutes: list.reduce((a, d) => a + Number(d.late_minutes || 0), 0),
    undertime_minutes: list.reduce((a, d) => a + Number(d.undertime_minutes || 0), 0),
    regular_hours: Math.round(list.reduce((a, d) => a + Number(d.regular_hours || 0), 0) * 100) / 100,
    overtime_hours: Math.round(list.reduce((a, d) => a + Number(d.overtime_hours || 0), 0) * 100) / 100,
    absent: list.filter((d) => d.status === 'absent').length,
    leave: list.filter((d) => d.status === 'leave').length,
    no_clock_out: worked.filter((d) => !d.time_out && d.attendance_date < today).length,
  };

  const reqs = (requests ?? []) as any[];
  const leave = ((types ?? []) as any[]).map((t) => {
    const b = ((balances ?? []) as any[]).find((x) => x.leave_type_id === t.id);
    const pending = reqs.filter((r) => r.leave_type_id === t.id && ['prepared', 'reviewed'].includes(r.status) && r.start_date.startsWith(String(year))).reduce((a, r) => a + Number(r.days), 0);
    const entitlement = b ? Number(b.entitlement) + Number(b.adjustment) : null;
    return { id: t.id, name: t.name, paid: t.paid, set_up: !!b, entitlement, default_days: t.default_days_per_year == null ? null : Number(t.default_days_per_year),
             used: b ? Number(b.used) : 0, pending, left: entitlement == null ? null : Math.round((entitlement - Number(b.used)) * 100) / 100 };
  });

  return {
    today, year,
    record: (rec as any) ?? null,
    schedule: scheduleText(schedule, today),
    range: { key: chosen.key, label: chosen.label, start: chosen.start, end: chosen.end }, choices: choices.map((c) => ({ key: c.key, label: c.label })),
    days: list, totals,
    corrections: ((corrections ?? []) as any[]).map((c) => ({ id: c.id, date: c.attendance?.attendance_date, reason: c.reason, status: c.status, rejection_reason: c.rejection_reason })),
    leave, requests: reqs.map((r) => ({ ...r, type: ((types ?? []) as any[]).find((t) => t.id === r.leave_type_id)?.name ?? '—' })),
  };
}

/** Build 120 — where sign-in lands: My Profile until the person has clocked in today, then the Dashboard. */
export async function landingFor(userId: string): Promise<'/profile' | '/dashboard'> {
  const db = createAdminClient();
  const { data: employee } = await db.from('employees').select('id,employment_status').eq('user_id', userId).maybeSingle();
  if (!employee) return '/dashboard';
  if (['separated', 'resigned', 'terminated', 'inactive'].includes(String((employee as any).employment_status ?? '').toLowerCase())) return '/dashboard';
  const { data: rec } = await db.from('attendance_records').select('time_in,status').eq('employee_id', (employee as any).id).eq('attendance_date', localDateFor(new Date(), TZ)).maybeSingle();
  if ((rec as any)?.time_in) return '/dashboard';
  if (rec && ['leave', 'holiday', 'rest_day'].includes((rec as any).status)) return '/dashboard';
  return '/profile';
}
