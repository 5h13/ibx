import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
// Build 52 (CC-01-class fix): reads go through the session-scoped client so the
// restrictive <table>_business_isolation RLS applies. This file previously used
// createAdminClient() (service role), which returned every business's rows.
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import TimekeepingManagement from '@/modules/admin/timekeeping/TimekeepingManagement';

export default async function TimekeepingPage({searchParams}:{searchParams?:{tab?:string}}){
 const profile=await getSessionProfile();
 if(!profile) redirect('/login');
 const can=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');
 if(!can) redirect('/dashboard');
 const db=createClient();
 const [{data:employees,error:e1},{data:schedules,error:e2},{data:attendance,error:e3},{data:corrections,error:e4},{data:periods,error:e5},{data:assignments,error:e6},{data:departments,error:e7},{data:positions,error:e8},{data:locations,error:e9},{data:leaveTypes,error:e10},{data:leaveRequests,error:e11},{data:leaveBalances,error:e12}]=await Promise.all([
  db.from('employees').select('id,employee_no,first_name,last_name,preferred_name,user_id,employment_status,department_id,position_id,work_location_id').order('last_name').order('first_name'),
  db.from('work_schedules').select('id,name,timezone,grace_minutes').order('name'),
  db.from('attendance_records').select('id,employee_id,attendance_date,schedule_id,time_in,break_out,break_in,time_out,regular_hours,overtime_hours,late_minutes,undertime_minutes,status,notes').order('attendance_date',{ascending:false}).limit(500),
  db.from('attendance_corrections').select('id,attendance_id,requested_by,reason,requested_time_in,requested_time_out,requested_status,status,rejection_reason').order('created_at',{ascending:false}).limit(200),
  db.from('attendance_periods').select('id,name,start_date,end_date,status').order('start_date',{ascending:false}),
  db.from('employee_schedule_assignments').select('id,employee_id,schedule_id,effective_from,effective_to').order('effective_from',{ascending:false}).limit(500),
  db.from('hr_departments').select('id,name').order('name'),
  db.from('hr_positions').select('id,name').order('name'),
  db.from('work_locations').select('id,name').order('name'),
  db.from('leave_types').select('id,code,name,paid,active,requires_approval,default_days_per_year').order('name'),
  db.from('leave_requests').select('id,employee_id,leave_type_id,start_date,end_date,day_type,days,reason,status,rejection_reason,requested_by').order('created_at',{ascending:false}).limit(300),
  db.from('employee_leave_balances').select('id,employee_id,leave_type_id,leave_year,entitlement,used,adjustment').eq('leave_year',new Date().getFullYear()),
 ]);
 for(const e of [e1,e2,e3,e4,e5,e6,e7,e8,e9,e10,e11,e12]) if(e) throw new Error(e.message);
 return <AuthedShell profile={profile}><TimekeepingManagement employees={(employees??[]) as any} schedules={(schedules??[]) as any} attendance={(attendance??[]) as any} corrections={(corrections??[]) as any} periods={(periods??[]) as any} assignments={(assignments??[]) as any} departments={(departments??[]) as any} positions={(positions??[]) as any} locations={(locations??[]) as any} leaveTypes={(leaveTypes??[]) as any} leaveRequests={(leaveRequests??[]) as any} leaveBalances={(leaveBalances??[]) as any} initialTab={searchParams?.tab}/></AuthedShell>;
}
