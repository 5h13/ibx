// supabase/seed-test-employees.mjs
//
// Build 58 — creates the role-audit TEST EMPLOYEE set supplied by the user
// (2026-09-27), with login accounts, employee records, section grants and
// (for the driver) a Fleet driver record.
//
// Role mapping (confirmed by the user):
//   SUPER_ADMIN              super_admin, no business (all businesses)
//   BUSINESS_ADMIN           business_admin in that business (the former
//                            BUSINESS_SUPER_ADMIN is retired and maps here)
//   ADMIN_STAFF / APPROVER   admin section, preparer / approver
//   FINANCE_STAFF / APPROVER finance section, preparer / approver
//   LOGISTICS_STAFF / APPR.  logistics section, preparer / approver
//   DRIVER                   = LOGISTICS_STAFF + a Fleet driver record
//   SALES_MARKETING_*        sales section + marketing section grants
// An approver may also review (Build 58), so approvers get the approver
// grant only.
//
// Business "ALL": the app gives every user exactly one business (punchlist
// RA-07), so each ALL employee gets ONE ACCOUNT PER BUSINESS, e.g.
//   lorenzo.santiago.aton@ibx.test / .ishabella@ / .pili@
// Single-business employees get firstname.lastname@ibx.test.
//
// Every account uses the same test password (IBX_TEST_PASSWORD, default
// "5h13xx" — Supabase needs 6+ characters). Re-running is safe: existing accounts are updated to match.
//
// Usage (from the project folder):
//   node supabase/seed-test-employees.mjs --dry-run   # show the plan only
//   node supabase/seed-test-employees.mjs             # create / update
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in supabase/.env
// (same as seed-users.mjs).

import { fileURLToPath } from 'url';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const TEST_PASSWORD = process.env.IBX_TEST_PASSWORD || '5h13xx';
const BUSINESSES = ['ATON', 'ISHABELLA', 'PILI'];

// Supplied test set (role names as given; BUSINESS_SUPER_ADMIN -> BUSINESS_ADMIN).
export const TEST_EMPLOYEES = [
  { name: 'Elias Montemayor', roles: ['SUPER_ADMIN'], business: 'GLOBAL' },
  { name: 'Ramon Aguilar', roles: ['BUSINESS_ADMIN'], business: 'ATON' },
  { name: 'Clarisse Domingo', roles: ['BUSINESS_ADMIN'], business: 'ATON' },
  { name: 'Jethro Manalili', roles: ['BUSINESS_ADMIN'], business: 'ISHABELLA' },
  { name: 'Rowena Fajardo', roles: ['BUSINESS_ADMIN'], business: 'ISHABELLA' },
  { name: 'Marco Dizon', roles: ['BUSINESS_ADMIN'], business: 'PILI' },
  { name: 'Aira Custodio', roles: ['BUSINESS_ADMIN'], business: 'PILI' },
  { name: 'Lorenzo Santiago', roles: ['ADMIN_STAFF'], business: 'ALL' },
  { name: 'Maevelyn Cruz', roles: ['ADMIN_APPROVER'], business: 'ALL' },
  { name: 'Patrick Alcaraz', roles: ['FINANCE_STAFF'], business: 'ALL' },
  { name: 'Janine Robles', roles: ['FINANCE_APPROVER'], business: 'ALL' },
  { name: 'Kenneth Soriano', roles: ['LOGISTICS_STAFF'], business: 'ALL' },
  { name: 'Harold Yambao', roles: ['LOGISTICS_APPROVER'], business: 'ALL' },
  { name: 'Jerome Catapang', roles: ['DRIVER'], business: 'ALL' },
  { name: 'Shaira Villanueva', roles: ['SALES_MARKETING_STAFF'], business: 'ALL' },
  { name: 'Darren Velasco', roles: ['SALES_MARKETING_APPROVER'], business: 'ALL' },
];

// role preset -> { appRole, homeSection, grants: [[section, workflow]] }
const PRESET = {
  SUPER_ADMIN: { appRole: 'super_admin', home: null, grants: [] },
  BUSINESS_ADMIN: { appRole: 'business_admin', home: null, grants: [] },
  ADMIN_STAFF: { appRole: 'admin', home: 'admin', grants: [['admin', 'preparer']] },
  ADMIN_APPROVER: { appRole: 'admin', home: 'admin', grants: [['admin', 'approver']] },
  FINANCE_STAFF: { appRole: 'finance', home: 'finance', grants: [['finance', 'preparer']] },
  FINANCE_APPROVER: { appRole: 'finance', home: 'finance', grants: [['finance', 'approver']] },
  LOGISTICS_STAFF: { appRole: 'logistics', home: 'logistics', grants: [['logistics', 'preparer']] },
  LOGISTICS_APPROVER: { appRole: 'logistics', home: 'logistics', grants: [['logistics', 'approver']] },
  DRIVER: { appRole: 'logistics', home: 'logistics', grants: [['logistics', 'preparer']], driver: true },
  SALES_MARKETING_STAFF: { appRole: 'sales', home: 'sales', grants: [['sales', 'preparer'], ['marketing', 'preparer']] },
  SALES_MARKETING_APPROVER: { appRole: 'sales', home: 'sales', grants: [['sales', 'approver'], ['marketing', 'approver']] },
};

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

/** Expand the test set into concrete accounts (pure; used by --dry-run). */
export function planAccounts(employees = TEST_EMPLOYEES) {
  const out = [];
  for (const e of employees) {
    const presets = e.roles.map((r) => {
      const key = r.toUpperCase().replace(/\s+/g, '_') === 'BUSINESS_SUPER_ADMIN' ? 'BUSINESS_ADMIN' : r.toUpperCase().replace(/\s+/g, '_');
      if (!PRESET[key]) throw new Error(`Unknown role ${r} for ${e.name}`);
      return { key, ...PRESET[key] };
    });
    const first = presets[0];
    const grants = [...new Map(presets.flatMap((p) => p.grants).map((g) => [g.join(':'), g])).values()];
    const [firstName, ...rest] = e.name.split(' ');
    const lastName = rest.join(' ') || firstName;
    const targets = e.business === 'ALL' ? BUSINESSES : e.business === 'GLOBAL' ? [null] : [e.business];
    for (const biz of targets) {
      out.push({
        email: `${slug(e.name)}${e.business === 'ALL' ? '.' + biz.toLowerCase() : ''}@ibx.test`,
        fullName: e.business === 'ALL' ? `${e.name} (${biz[0] + biz.slice(1).toLowerCase()})` : e.name,
        firstName, lastName,
        roles: presets.map((p) => p.key),
        appRole: first.appRole,
        home: first.home,
        business: biz,
        grants,
        driver: presets.some((p) => p.driver),
        employee: first.appRole !== 'super_admin', // the Global Super Admin has no business, so no employee record
      });
    }
  }
  return out;
}

function printPlan(accounts) {
  console.log(`\n${accounts.length} accounts (password for all: "${TEST_PASSWORD}"):\n`);
  for (const a of accounts) {
    console.log(`  ${a.email.padEnd(42)} ${String(a.business ?? 'GLOBAL').padEnd(10)} ${a.appRole.padEnd(15)} ${a.grants.map((g) => g.join(':')).join(', ') || '(full access)'}${a.driver ? '  + Fleet driver' : ''}`);
  }
}

async function main() {
  const accounts = planAccounts();
  printPlan(accounts);
  if (DRY_RUN) { console.log('\n--dry-run: nothing written.'); return; }

  const { createClient } = await import('@supabase/supabase-js');
  const dotenv = (await import('dotenv')).default;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // supabase/.env first, then the app's own env files (first value found wins)
  for (const f of [path.join(__dirname, '.env'), path.join(__dirname, '..', '.env.local'), path.join(__dirname, '..', '.env')]) {
    dotenv.config({ path: f, quiet: true });
  }
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('Missing Supabase URL or service role key. Looked in supabase/.env, .env.local and .env for SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
  const sections = Object.fromEntries(must(await db.from('sections').select('id,code'), 'sections').map((s) => [s.code, s.id]));
  const businesses = Object.fromEntries(must(await db.from('businesses').select('id,code'), 'businesses').map((b) => [b.code, b.id]));
  for (const b of BUSINESSES) if (!businesses[b]) throw new Error(`Business ${b} not found`);

  // all existing auth users (paged)
  const existing = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    data.users.forEach((u) => existing.set(u.email?.toLowerCase(), u));
    if (data.users.length < 1000) break;
  }

  let superAdminId = null;
  const results = [];
  // super admin first (driver records need a created_by)
  for (const a of [...accounts].sort((x, y) => (x.appRole === 'super_admin' ? -1 : 0) - (y.appRole === 'super_admin' ? -1 : 0))) {
    let authUser = existing.get(a.email);
    if (!authUser) {
      authUser = must(await db.auth.admin.createUser({ email: a.email, password: TEST_PASSWORD, email_confirm: true, user_metadata: { full_name: a.fullName } }), `create ${a.email}`).user;
    } else {
      // keep every test login on the current test password
      must(await db.auth.admin.updateUserById(authUser.id, { password: TEST_PASSWORD, email_confirm: true, user_metadata: { full_name: a.fullName } }), `reset password ${a.email}`);
    }
    const userId = authUser.id;
    if (a.appRole === 'super_admin') superAdminId = userId;
    const businessId = a.business ? businesses[a.business] : null;

    // An open role-audit session would be overwritten by this reset; end it first.
    await db.from('role_audit_sessions').delete().eq('user_id', userId);

    must(await db.from('users').upsert({ id: userId, email: a.email, full_name: a.fullName, role: a.appRole, section_id: a.home ? sections[a.home] : null, business_id: businessId, is_active: true }, { onConflict: 'id' }), `users ${a.email}`);
    must(await db.from('user_access').delete().eq('user_id', userId), `reset grants ${a.email}`);
    if (a.grants.length) {
      must(await db.from('user_access').insert(a.grants.map(([sec, wf]) => ({ user_id: userId, section_id: sections[sec], workflow_role: wf }))), `grants ${a.email}`);
    }

    let employeeNo = '—';
    if (a.employee) {
      const found = must(await db.from('employees').select('id,employee_no').eq('user_id', userId).maybeSingle(), `find employee ${a.email}`);
      let emp = found;
      if (found) {
        must(await db.from('employees').update({ first_name: a.firstName, last_name: a.lastName, work_email: a.email, business_id: businessId, employment_status: 'active' }).eq('id', found.id), `update employee ${a.email}`);
      } else {
        emp = must(await db.from('employees').insert({ first_name: a.firstName, last_name: a.lastName, work_email: a.email, business_id: businessId, user_id: userId, employment_type: 'regular', employment_status: 'active' }).select('id,employee_no').single(), `create employee ${a.email}`);
      }
      employeeNo = emp.employee_no;
      if (a.driver) {
        const drv = must(await db.from('fleet_drivers').select('id').eq('employee_id', emp.id).maybeSingle(), `find driver ${a.email}`);
        if (!drv) {
          // license_no left empty: only an Admin approver may set it (U009 guard)
          must(await db.from('fleet_drivers').insert({ employee_id: emp.id, business_id: businessId, authorized: true, created_by: superAdminId ?? userId }), `create driver ${a.email}`);
        }
      }
    }
    results.push({ ...a, employeeNo });
    console.log(`  ✓ ${a.email}  ${employeeNo}`);
  }
  console.log(`\nDone: ${results.length} accounts. Password for all: "${TEST_PASSWORD}".`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
