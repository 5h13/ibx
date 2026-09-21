// supabase/seed-users.mjs
//
// Creates the test accounts for the Prepare -> Review -> Approve workflow.
// auth.users rows carry hashed passwords, so they must be created through
// the Supabase Auth Admin API (this script) rather than a raw SQL insert.
//
// Usage:
//   1. npm install
//   2. Put your keys in supabase/.env (see .env.example)
//   3. node supabase/seed-users.mjs
//
// All test accounts share the password below. Change TEST_PASSWORD (and
// re-run against a fresh project) before this ever touches production data.

import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';

// Load supabase/.env explicitly (relative to this file), rather than relying
// on an external .env loader that may look in the project root instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });
console.log(`Looking for env file at: ${envPath}`);
console.log(result.error ? `  -> not found / unreadable: ${result.error.message}` : `  -> loaded ${Object.keys(result.parsed ?? {}).length} variable(s)`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_PASSWORD = process.env.IBX_TEST_PASSWORD || '5h13';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  { email: 'super.admin@ibx.test', full_name: 'Super Admin (Test)', role: 'super_admin', section_code: null, workflow_roles: [] },
  { email: 'preparer.sales@ibx.test', full_name: 'Preparer (Sales, Test)', role: 'sales', section_code: 'sales', workflow_roles: ['preparer'] },
  { email: 'reviewer.sales@ibx.test', full_name: 'Reviewer (Sales, Test)', role: 'sales', section_code: 'sales', workflow_roles: ['reviewer'] },
  { email: 'approver.sales@ibx.test', full_name: 'Approver (Sales, Test)', role: 'sales', section_code: 'sales', workflow_roles: ['approver'] },
];

async function getSectionMap() {
  const { data, error } = await supabase.from('sections').select('id, code');
  if (error) throw error;
  return Object.fromEntries(data.map((s) => [s.code, s.id]));
}

async function upsertAuthUser(email, password, fullName) {
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email === email);
  if (existing) {
    console.log(`  auth user already exists: ${email}`);
    return existing;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  console.log(`  created auth user: ${email}`);
  return data.user;
}

async function main() {
  console.log(`Seeding IBX test users (password: "${TEST_PASSWORD}")...`);
  const sections = await getSectionMap();

  for (const u of TEST_USERS) {
    const authUser = await upsertAuthUser(u.email, TEST_PASSWORD, u.full_name);
    const sectionId = u.section_code ? sections[u.section_code] : null;

    const { error: userErr } = await supabase.from('users').upsert(
      { id: authUser.id, email: u.email, full_name: u.full_name, role: u.role, section_id: sectionId, is_active: true },
      { onConflict: 'id' }
    );
    if (userErr) throw userErr;

    for (const wr of u.workflow_roles) {
      const { error: accessErr } = await supabase.from('user_access').upsert(
        { user_id: authUser.id, section_id: sectionId, workflow_role: wr },
        { onConflict: 'user_id,section_id,workflow_role' }
      );
      if (accessErr) throw accessErr;
    }
    console.log(`  linked public.users + user_access for ${u.email} (${u.role}${u.workflow_roles.length ? ', ' + u.workflow_roles.join('/') : ''})`);
  }

  console.log('\nDone. Test logins (all use the same password):');
  for (const u of TEST_USERS) {
    console.log(`  ${u.email}  —  password: ${TEST_PASSWORD}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});