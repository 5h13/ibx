// app/api/approvals/route.ts
//
// GET /api/approvals — everything pending review/approval that RLS allows
// the current session to see (mirrors app/approvals/page.tsx).

import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function GET() {
  const supabase = createClient();
  const [{ data: expenses, error: expErr }, { data: sales, error: salesErr }] = await Promise.all([
    supabase.from('expenses').select('*').in('status', ['prepared', 'reviewed']),
    supabase.from('sales_data').select('*').in('status', ['prepared', 'reviewed']),
  ]);
  if (expErr || salesErr) {
    return NextResponse.json({ error: (expErr ?? salesErr)?.message }, { status: 400 });
  }
  return NextResponse.json({ data: { expenses, sales } });
}
