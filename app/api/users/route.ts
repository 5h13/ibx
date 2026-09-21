// app/api/users/route.ts
//
// GET /api/users — super admin only (RLS on public.users enforces this;
// a non-super-admin caller simply gets back their own row only).

import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.from('users').select('id, email, full_name, role, section_id, is_active');
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
