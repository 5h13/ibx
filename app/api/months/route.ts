// app/api/months/route.ts
//
// GET /api/months — list all financial periods.

import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function GET() {
  const supabase = createClient();
  const { data, error } = await supabase.from('months').select('*').order('year', { ascending: false }).order('month', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
