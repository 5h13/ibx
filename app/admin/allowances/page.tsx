// Build 91 — Expense Allowances (Business Admin): monthly limits per person and category.
import { isLoginOnlyEmail } from '@/core/auth/loginEmail';
import { redirect } from 'next/navigation';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isAdminTier } from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import { AuthedShell } from '@/core/layout/AuthedShell';
import { AllowancesManagement } from '@/modules/admin/allowances/AllowancesManagement';

export const dynamic = 'force-dynamic';

export default async function AllowancesPage() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!isAdminTier(profile)) redirect('/dashboard');
  const b = profile.user.business_id;
  if (!b) return <AuthedShell profile={profile}><div className="rounded border bg-white p-6 text-slate-600">Select a business in &quot;Acting as&quot; — allowances are set per store.</div></AuthedShell>;
  const db = createClient();
  const [{ data: rows, error }, { data: cats }, { data: users }, { data: agents }] = await Promise.all([
    db.from('expense_allowances').select('id,user_id,agent_id,category_id,monthly_limit,notes,active').eq('business_id', b).is('agent_id', null).order('created_at'),
    db.from('admin_expense_categories').select('id,code,name').eq('active', true).order('name'),
    db.from('users').select('id,full_name,email,username,role').eq('business_id', b).eq('is_active', true).neq('role', 'agent').order('full_name'),
    Promise.resolve({ data: [] as any[] }), // Build 125 (UIA-45): allowances are for employees only
  ]);
  if (error) throw new Error(error.message);
  return (
    <AuthedShell profile={profile}>
      <AllowancesManagement rows={(rows ?? []) as any[]} categories={(cats ?? []) as any[]} users={((users ?? []) as any[]).map((u: any) => ({ ...u, email: isLoginOnlyEmail(u.email) ? u.username : u.email }))} agents={(agents ?? []) as any[]} />
    </AuthedShell>
  );
}
