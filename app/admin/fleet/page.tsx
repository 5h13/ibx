import { redirect } from 'next/navigation';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { AuthedShell } from '@/core/layout/AuthedShell';
import FleetManagement from '@/modules/admin/fleet/FleetManagement';
export default async function FleetPage(){const profile=await getSessionProfile();if(!profile)redirect('/login');const can=isAdminTier(profile)||profile.user.section_code==='admin'||profile.access.some(a=>a.section_code==='admin');if(!can)redirect('/dashboard');
// Phase 7 business-isolation fix: same CC-01-class bug as assets/supplies —
// this page previously read through createAdminClient() (service-role,
// bypasses RLS) despite every fleet_* table already carrying correct
// RESTRICTIVE business-isolation RLS since A001.
const db=createClient();const [{data:vehicles,error:ve},{data:employees,error:ee},{data:drivers,error:de},{data:assignments,error:ae},{data:trips,error:te},{data:expenses,error:xe},{data:maintenance,error:me},{data:maintenanceRequests,error:mre}]=await Promise.all([
 db.from('fleet_vehicles').select('*').order('vehicle_no'),
 db.from('employees').select('id,employee_no,first_name,last_name,preferred_name,employment_status').neq('employment_status','separated').order('last_name'),
 // U009 — license_no is CONFIDENTIAL, deliberately left out of this general
 // fetch; merged back in below only for Admin approvers/Super Admin.
 db.from('fleet_drivers').select('id,employee_id,license_expiry,license_type,authorized,notes,created_by,created_at,updated_at,employee:employees(employee_no,first_name,last_name,preferred_name)').order('created_at',{ascending:false}),
 db.from('fleet_assignments').select('*,employee:employees(employee_no,first_name,last_name,preferred_name),vehicle:fleet_vehicles(vehicle_no)').order('assigned_at',{ascending:false}).limit(200),
 db.from('fleet_trips').select('*,vehicle:fleet_vehicles(vehicle_no),driver:employees(employee_no,first_name,last_name,preferred_name)').order('trip_date',{ascending:false}).limit(200),
 db.from('fleet_expenses').select('*,vehicle:fleet_vehicles(vehicle_no)').order('expense_date',{ascending:false}).limit(200),
 db.from('fleet_maintenance').select('*,vehicle:fleet_vehicles(vehicle_no)').order('service_date',{ascending:false}).limit(200),
 // U036 — Fleet Maintenance Requests, filed through the shared
 // internal_requests engine (category code 'fleet_maintenance').
 db.from('internal_requests').select('*,vehicle:fleet_vehicles(vehicle_no),items:internal_request_items(item_description),category:internal_request_categories!inner(code)').eq('category.code','fleet_maintenance').order('created_at',{ascending:false}).limit(200)
]);if(ve||ee||de||ae||te||xe||me||mre)throw new Error(ve?.message||ee?.message||de?.message||ae?.message||te?.message||xe?.message||me?.message||mre?.message||'Unable to load fleet.');
const isApprover=isAdminTier(profile)||profile.access.some(a=>a.section_code==='admin'&&a.workflow_role==='approver');
let driversOut:Array<Record<string,unknown>>=(drivers??[]) as any[];
if(isApprover&&driversOut.length){const {data:licenseRows,error:le}=await db.from('fleet_drivers').select('id,license_no');if(le)throw new Error(le.message);const byId=new Map((licenseRows??[]).map((r:any)=>[r.id,r.license_no]));driversOut=driversOut.map((d:any)=>({...d,license_no:byId.get(d.id)??null}))}
else{driversOut=driversOut.map((d:any)=>({...d,license_no:null}))}
return <AuthedShell profile={profile}><FleetManagement profile={profile} vehicles={(vehicles??[]) as any} employees={(employees??[]) as any} drivers={driversOut as any} assignments={(assignments??[]) as any} trips={(trips??[]) as any} expenses={(expenses??[]) as any} maintenance={(maintenance??[]) as any} maintenanceRequests={(maintenanceRequests??[]) as any} canViewConfidential={isApprover}/></AuthedShell>}
