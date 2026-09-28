'use server';
import { appError } from '@/core/errors/appError';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { calculateAttendance, localDateFor } from './calculator';
import { notifyWorkflowRole, notifyUsers } from '@/shared/notifications/service';

function biz(p:{user:{business_id:string|null}}):{business_id?:string}{return p.user.business_id?{business_id:p.user.business_id}:{};}
type AttendanceStatus = 'present'|'absent'|'late'|'undertime'|'half_day'|'leave'|'holiday'|'rest_day'|'official_business'|'work_from_home'|'incomplete';
const STATUSES: AttendanceStatus[] = ['present','absent','late','undertime','half_day','leave','holiday','rest_day','official_business','work_from_home','incomplete'];

async function requireAdmin() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  if (!isAdminTier(profile) && !profile.access.some(a => a.section_code === 'admin') && profile.user.section_code !== 'admin') throw appError('Admin access required.');
  return profile;
}
function required(fd: FormData, key: string) { const v=String(fd.get(key)??'').trim(); if(!v) throw appError(`${key.replaceAll('_',' ')} is required.`); return v; }
function optional(fd: FormData,key:string){const v=String(fd.get(key)??'').trim(); return v||null;}
function validateStatus(v:string): asserts v is AttendanceStatus { if(!STATUSES.includes(v as AttendanceStatus)) throw appError('Invalid attendance status.'); }
async function audit(actorId:string, entityTable:string, entityId:string, action:string, detail:Record<string,unknown>){const db=createClient(); const {error}=await db.from('audit_log').insert({actor_id:actorId,entity_table:entityTable,entity_id:entityId,action,detail}); if(error) throw appError(error.message);}

export async function createScheduleAction(fd:FormData){const actor=await requireAdmin(); const db=createClient(); const name=required(fd,'name'); const days=['monday','tuesday','wednesday','thursday','friday','saturday','sunday']; const payload:any={...biz(actor),name,timezone:optional(fd,'timezone')||'Asia/Manila',grace_minutes:Number(fd.get('grace_minutes')||0)}; for(const d of days){payload[`${d}_in`]=optional(fd,`${d}_in`);payload[`${d}_out`]=optional(fd,`${d}_out`);payload[`${d}_break_start`]=optional(fd,`${d}_break_start`);payload[`${d}_break_end`]=optional(fd,`${d}_break_end`);} const {data,error}=await db.from('work_schedules').insert(payload).select('id').single(); if(error||!data) throw appError(error?.message||'Unable to create schedule.'); await audit(actor.user.id,'work_schedules',data.id,'created',{name}); revalidatePath('/admin/timekeeping'); return {ok:true};}

export async function assignScheduleAction(fd:FormData){const actor=await requireAdmin(); const db=createClient(); const employeeId=required(fd,'employee_id'); const scheduleId=required(fd,'schedule_id'); const from=required(fd,'effective_from'); const to=optional(fd,'effective_to'); if(to&&to<from) throw appError('Effective-to date cannot be before effective-from.'); const {data,error}=await db.from('employee_schedule_assignments').insert({...biz(actor),employee_id:employeeId,schedule_id:scheduleId,effective_from:from,effective_to:to}).select('id').single(); if(error||!data) throw appError(error?.message||'Unable to assign schedule.'); await audit(actor.user.id,'employee_schedule_assignments',data.id,'created',{employee_id:employeeId,schedule_id:scheduleId,effective_from:from,effective_to:to}); revalidatePath('/admin/timekeeping'); return {ok:true};}

async function findAssignedSchedule(db: ReturnType<typeof createClient>, employeeId: string, date: string) {
  const { data: assignment, error } = await db.from('employee_schedule_assignments').select('id,schedule_id,effective_from,effective_to').eq('employee_id', employeeId).lte('effective_from', date).or(`effective_to.is.null,effective_to.gte.${date}`).order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (error) throw appError(error.message);
  if (!assignment) return null;
  const { data: schedule, error: scheduleError } = await db.from('work_schedules').select('*').eq('id', assignment.schedule_id).single();
  if (scheduleError) throw appError(scheduleError.message);
  return { assignment, schedule };
}

async function calculateForRecord(db: ReturnType<typeof createClient>, record: any) {
  let schedule = null;
  if (record.schedule_id) {
    const { data, error } = await db.from('work_schedules').select('*').eq('id', record.schedule_id).maybeSingle();
    if (error) throw appError(error.message);
    schedule = data;
  }
  if (!schedule) {
    const assigned = await findAssignedSchedule(db, record.employee_id, record.attendance_date);
    if (!assigned) return { schedule_id: null, regular_hours: 0, overtime_hours: 0, late_minutes: 0, undertime_minutes: 0, status: record.status || 'present' };
    schedule = assigned.schedule;
    record.schedule_id = schedule.id;
  }
  const calc = calculateAttendance({ attendanceDate: record.attendance_date, schedule, timeIn: record.time_in, breakOut: record.break_out, breakIn: record.break_in, timeOut: record.time_out });
  const specialStatuses = ['absent','half_day','leave','holiday','rest_day','official_business','work_from_home'];
  const status = specialStatuses.includes(record.status) ? record.status : calc.status;
  return { schedule_id: schedule.id, ...calc, status };
}

export async function saveAttendanceAction(fd: FormData) {
  const actor = await requireAdmin(); const db = createClient();
  const employeeId = required(fd, 'employee_id'); const date = required(fd, 'attendance_date');
  const requestedStatus = required(fd, 'status'); validateStatus(requestedStatus);
  const existing = await db.from('attendance_records').select('id,period_id').eq('employee_id', employeeId).eq('attendance_date', date).maybeSingle();
  if (existing.error) throw appError(existing.error.message);
  if (existing.data?.period_id) { const { data: period } = await db.from('attendance_periods').select('status').eq('id', existing.data.period_id).maybeSingle(); if (period?.status === 'locked') throw appError('This attendance record belongs to a locked period.'); }
  const values:any = { employee_id: employeeId, attendance_date: date, schedule_id: optional(fd,'schedule_id'), time_in: optional(fd,'time_in'), break_out: optional(fd,'break_out'), break_in: optional(fd,'break_in'), time_out: optional(fd,'time_out'), status: requestedStatus, notes: optional(fd,'notes'), prepared_by: actor.user.id };
  const calculated = await calculateForRecord(db, values); Object.assign(values, calculated);
  const {data,error}=await db.from('attendance_records').upsert(values,{onConflict:'employee_id,attendance_date'}).select('id').single();
  if(error||!data) throw appError(error?.message||'Unable to save attendance.');
  await audit(actor.user.id,'attendance_records',data.id,'calculated',{employee_id:employeeId,attendance_date:date,...calculated});
  revalidatePath('/admin/timekeeping'); return {ok:true};
}

export async function recalculateAttendanceAction(fd: FormData) {
  const actor=await requireAdmin(); const id=required(fd,'attendance_id'); const db=createClient();
  const {data:record,error}=await db.from('attendance_records').select('*').eq('id',id).single(); if(error||!record) throw appError(error?.message||'Attendance record not found.');
  if(record.period_id){const {data:period}=await db.from('attendance_periods').select('status').eq('id',record.period_id).maybeSingle(); if(period?.status==='locked') throw appError('This attendance record belongs to a locked period.');}
  const calculated=await calculateForRecord(db,record); const {error:updateError}=await db.from('attendance_records').update({...calculated,updated_at:new Date().toISOString()}).eq('id',id); if(updateError) throw appError(updateError.message);
  await audit(actor.user.id,'attendance_records',id,'recalculated',calculated); revalidatePath('/admin/timekeeping'); return {ok:true,calculation:calculated};
}

export async function clockInAction(){
  const profile=await getSessionProfile(); if(!profile||!profile.user.is_active) throw appError('Authentication required.'); const db=createClient();
  const {data:employee}=await db.from('employees').select('id').eq('user_id',profile.user.id).maybeSingle(); if(!employee) throw appError('Your account is not linked to an employee record.');
  const now=new Date(); const baseDate=localDateFor(now,'Asia/Manila'); const baseAssigned=await findAssignedSchedule(db,employee.id,baseDate); const timeZone=baseAssigned?.schedule?.timezone||'Asia/Manila'; const date=localDateFor(now,timeZone); const assigned=await findAssignedSchedule(db,employee.id,date);
  const {data:existing}=await db.from('attendance_records').select('id,time_in,time_out').eq('employee_id',employee.id).eq('attendance_date',date).maybeSingle(); if(existing?.time_in) throw appError('You are already clocked in today.');
  const values:any={employee_id:employee.id,attendance_date:date,time_in:now.toISOString(),status:'present',schedule_id:assigned?.schedule.id||null,prepared_by:profile.user.id};
  const calculated=assigned?calculateAttendance({attendanceDate:date,schedule:assigned.schedule,timeIn:values.time_in,breakOut:null,breakIn:null,timeOut:null}):{regular_hours:0,overtime_hours:0,late_minutes:0,undertime_minutes:0,status:'present' as const}; Object.assign(values,calculated);
  const {data,error}=await db.from('attendance_records').upsert(values,{onConflict:'employee_id,attendance_date'}).select('id').single(); if(error||!data) throw appError(error?.message||'Unable to clock in.');
  await audit(profile.user.id,'attendance_records',data.id,'created',{action:'clock_in',schedule_id:values.schedule_id,late_minutes:calculated.late_minutes}); revalidatePath('/admin/timekeeping'); revalidatePath('/dashboard'); return {ok:true};
}

export async function clockOutAction(){
  const profile=await getSessionProfile(); if(!profile||!profile.user.is_active) throw appError('Authentication required.'); const db=createClient(); const {data:employee}=await db.from('employees').select('id').eq('user_id',profile.user.id).maybeSingle(); if(!employee) throw appError('Your account is not linked to an employee record.');
  const now=new Date(); const baseDate=localDateFor(now,'Asia/Manila'); const baseAssigned=await findAssignedSchedule(db,employee.id,baseDate); const timeZone=baseAssigned?.schedule?.timezone||'Asia/Manila'; const date=localDateFor(now,timeZone);
  const {data:existing}=await db.from('attendance_records').select('*').eq('employee_id',employee.id).eq('attendance_date',date).maybeSingle(); if(!existing?.time_in) throw appError('You have not clocked in today.'); if(existing.time_out) throw appError('You are already clocked out today.');
  existing.time_out=now.toISOString(); const calculated=await calculateForRecord(db,existing); const {error}=await db.from('attendance_records').update({time_out:now.toISOString(),...calculated,updated_at:new Date().toISOString()}).eq('id',existing.id); if(error) throw appError(error.message);
  await audit(profile.user.id,'attendance_records',existing.id,'edited',{action:'clock_out',...calculated}); revalidatePath('/admin/timekeeping'); revalidatePath('/dashboard'); return {ok:true};
}

export async function requestCorrectionAction(fd:FormData){const profile=await getSessionProfile(); if(!profile||!profile.user.is_active) throw appError('Authentication required.'); const db=createClient(); const attendanceId=required(fd,'attendance_id'); const reason=required(fd,'reason'); const {data:record}=await db.from('attendance_records').select('id,employee_id').eq('id',attendanceId).maybeSingle(); if(!record) throw appError('Attendance record not found.'); const {data:employee}=await db.from('employees').select('id,user_id').eq('id',record.employee_id).maybeSingle(); if(!employee || (employee.user_id!==profile.user.id && !isAdminTier(profile))) throw appError('You can only request corrections for your own attendance.'); const status=optional(fd,'requested_status'); if(status) validateStatus(status); const {data,error}=await db.from('attendance_corrections').insert({...biz(profile),attendance_id:attendanceId,requested_by:profile.user.id,reason,requested_time_in:optional(fd,'requested_time_in'),requested_break_out:optional(fd,'requested_break_out'),requested_break_in:optional(fd,'requested_break_in'),requested_time_out:optional(fd,'requested_time_out'),requested_status:status}).select('id,business_id').single(); if(error||!data) throw appError(error?.message||'Unable to request correction.'); await audit(profile.user.id,'attendance_corrections',data.id,'submitted',{attendance_id:attendanceId}); await notifyWorkflowRole(data.business_id,'admin','reviewer',{title:'Attendance correction needs review',message:reason,entity_table:'attendance_corrections',entity_id:data.id,action_url:'/admin/timekeeping'}); revalidatePath('/admin/timekeeping'); return {ok:true};}

export async function reviewCorrectionAction(fd:FormData){const actor=await requireAdmin(); const id=required(fd,'correction_id'); const decision=required(fd,'decision'); const db=createClient(); if(!['reviewed','rejected'].includes(decision)) throw appError('Invalid review decision.'); const {data,error}=await db.from('attendance_corrections').update({status:decision,reviewed_by:actor.user.id,reviewed_at:new Date().toISOString(),rejection_reason:decision==='rejected'?optional(fd,'rejection_reason'):null}).eq('id',id).eq('status','prepared').select('id,business_id,requested_by').single(); if(error||!data) throw appError(error?.message||'Correction is no longer pending.'); await audit(actor.user.id,'attendance_corrections',id,decision,{decision}); if(decision==='reviewed') await notifyWorkflowRole(data.business_id,'admin','approver',{title:'Attendance correction needs approval',message:'A reviewed attendance correction is awaiting your approval.',entity_table:'attendance_corrections',entity_id:id,action_url:'/admin/timekeeping'}); else if(data.requested_by) await notifyUsers([data.requested_by],data.business_id,{title:'Attendance correction rejected',message:optional(fd,'rejection_reason')||'Your attendance correction request was rejected.',entity_table:'attendance_corrections',entity_id:id,action_url:'/admin/timekeeping'}); revalidatePath('/admin/timekeeping'); return {ok:true};}

export async function approveCorrectionAction(fd:FormData){
  const actor=await requireAdmin(); const id=required(fd,'correction_id'); const db=createClient();
  const {data:c,error:ce}=await db.from('attendance_corrections').select('*').eq('id',id).eq('status','reviewed').maybeSingle(); if(ce||!c) throw appError(ce?.message||'Reviewed correction not found.');
  const {data:attendance}=await db.from('attendance_records').select('*').eq('id',c.attendance_id).single(); if(!attendance) throw appError('Attendance record not found.');
  const patch:any={time_in:c.requested_time_in,time_out:c.requested_time_out,break_out:c.requested_break_out,break_in:c.requested_break_in,updated_at:new Date().toISOString(),approved_by:actor.user.id}; if(c.requested_status) patch.status=c.requested_status;
  const {error:ae}=await db.from('attendance_records').update(patch).eq('id',attendance.id); if(ae) throw appError(ae.message);
  const {data:updated,error:ue}=await db.from('attendance_records').select('*').eq('id',attendance.id).single(); if(ue||!updated) throw appError(ue?.message||'Unable to reload attendance.');
  const calculated=await calculateForRecord(db,updated); const {error:re}=await db.from('attendance_records').update(calculated).eq('id',attendance.id); if(re) throw appError(re.message);
  const {error}=await db.from('attendance_corrections').update({status:'approved',approved_by:actor.user.id,approved_at:new Date().toISOString()}).eq('id',id); if(error) throw appError(error.message);
  await audit(actor.user.id,'attendance_corrections',id,'approved',{attendance_id:c.attendance_id,...calculated});
  if(c.requested_by) await notifyUsers([c.requested_by],c.business_id,{title:'Attendance correction approved',message:'Your attendance correction request was approved.',entity_table:'attendance_corrections',entity_id:id,action_url:'/admin/timekeeping'});
  revalidatePath('/admin/timekeeping'); return {ok:true};
}

export async function closePeriodAction(fd:FormData){const actor=await requireAdmin(); const id=required(fd,'period_id'); const db=createClient(); const {data,error}=await db.from('attendance_periods').update({status:'locked',locked_at:new Date().toISOString(),locked_by:actor.user.id}).eq('id',id).neq('status','locked').select('id').single(); if(error||!data) throw appError(error?.message||'Unable to lock period.'); await audit(actor.user.id,'attendance_periods',id,'approved',{action:'locked'}); revalidatePath('/admin/timekeeping'); return {ok:true};}

// U007 — Timekeeping Reminders. No cron/scheduler exists anywhere in this
// codebase, so this is a manually-triggered "check & notify" server action
// (an admin button on the consolidated Timekeeping & Leave page) rather than
// a background job. It computes three reminder cases and notifies through
// the existing U006 notification infrastructure -- never inventing a new
// notification path. Read-only over the data it scans; every actual write
// stays in the normal action flows above.
const STALE_CORRECTION_DAYS = 2;
const STALE_LEAVE_DAYS = 2;
export async function checkAndNotifyAction() {
  const actor = await requireAdmin();
  const db = createClient();
  const businessId = actor.user.business_id;
  const today = localDateFor(new Date(), 'Asia/Manila');
  const cutoffIso = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(); // 3 hours ago, so we don't nag employees still within a normal grace window

  // 1. No clock-in today for anyone with an active schedule assignment covering today, and no attendance record yet (or one with no time_in).
  let noClockInCount = 0;
  const { data: activeEmployees } = await db.from('employees').select('id,user_id,employment_status').in('employment_status', ['active', 'probationary']);
  const { data: todaysAssignments } = await db.from('employee_schedule_assignments').select('employee_id,effective_from,effective_to').lte('effective_from', today).or(`effective_to.is.null,effective_to.gte.${today}`);
  const assignedIds = new Set((todaysAssignments || []).map((a: any) => a.employee_id));
  const { data: todaysAttendance } = await db.from('attendance_records').select('employee_id,time_in').eq('attendance_date', today);
  const clockedInIds = new Set((todaysAttendance || []).filter((a: any) => a.time_in).map((a: any) => a.employee_id));
  const notifyEmployeeIds: string[] = [];
  for (const e of activeEmployees || []) {
    if (!assignedIds.has(e.id) || clockedInIds.has(e.id)) continue;
    noClockInCount++;
    if (e.user_id) notifyEmployeeIds.push(e.user_id);
  }
  if (notifyEmployeeIds.length) await notifyUsers(notifyEmployeeIds, businessId, { title: 'No clock-in recorded today', message: `You have not clocked in yet as of ${new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}.`, action_url: '/admin/timekeeping' });
  if (noClockInCount) await notifyWorkflowRole(businessId, 'admin', 'preparer', { title: `${noClockInCount} employee(s) missing today's clock-in`, message: 'These employees have an assigned schedule for today but no recorded time-in yet.', action_url: '/admin/timekeeping' });

  // 2. Corrections pending review/approval past the staleness window.
  const { data: staleCorrections } = await db.from('attendance_corrections').select('id,created_at,status').in('status', ['prepared', 'reviewed']).lt('created_at', new Date(Date.now() - STALE_CORRECTION_DAYS * 86400000).toISOString());
  if (staleCorrections && staleCorrections.length) {
    const pendingReview = staleCorrections.filter((c: any) => c.status === 'prepared').length;
    const pendingApproval = staleCorrections.filter((c: any) => c.status === 'reviewed').length;
    if (pendingReview) await notifyWorkflowRole(businessId, 'admin', 'reviewer', { title: `${pendingReview} attendance correction(s) awaiting review >${STALE_CORRECTION_DAYS}d`, message: 'These correction requests have been pending review for longer than expected.', action_url: '/admin/timekeeping' });
    if (pendingApproval) await notifyWorkflowRole(businessId, 'admin', 'approver', { title: `${pendingApproval} attendance correction(s) awaiting approval >${STALE_CORRECTION_DAYS}d`, message: 'These reviewed corrections have been pending approval for longer than expected.', action_url: '/admin/timekeeping' });
  }

  // 3. Leave requests pending review/approval past the staleness window.
  const { data: staleLeave } = await db.from('leave_requests').select('id,created_at,status').in('status', ['prepared', 'reviewed']).lt('created_at', new Date(Date.now() - STALE_LEAVE_DAYS * 86400000).toISOString());
  if (staleLeave && staleLeave.length) {
    const pendingReview = staleLeave.filter((c: any) => c.status === 'prepared').length;
    const pendingApproval = staleLeave.filter((c: any) => c.status === 'reviewed').length;
    if (pendingReview) await notifyWorkflowRole(businessId, 'admin', 'reviewer', { title: `${pendingReview} leave request(s) awaiting review >${STALE_LEAVE_DAYS}d`, message: 'These leave requests have been pending review for longer than expected.', action_url: '/admin/timekeeping?tab=leave' });
    if (pendingApproval) await notifyWorkflowRole(businessId, 'admin', 'approver', { title: `${pendingApproval} leave request(s) awaiting approval >${STALE_LEAVE_DAYS}d`, message: 'These reviewed leave requests have been pending approval for longer than expected.', action_url: '/admin/timekeeping?tab=leave' });
  }

  await audit(actor.user.id, 'attendance_records', actor.user.id, 'created', { action: 'timekeeping_reminders_check', no_clock_in: noClockInCount, stale_corrections: staleCorrections?.length || 0, stale_leave: staleLeave?.length || 0, cutoff: cutoffIso });
  revalidatePath('/admin/timekeeping');
  return { ok: true, noClockIn: noClockInCount, staleCorrections: staleCorrections?.length || 0, staleLeave: staleLeave?.length || 0 };
}
