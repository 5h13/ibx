// app/api/summary/route.ts
//
// GET /api/summary?month=<month_id>&section=<section_id optional>
// section omitted = company-wide row (section_id is null).

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function GET(req: NextRequest) {
  const monthId = req.nextUrl.searchParams.get('month');
  const sectionId = req.nextUrl.searchParams.get('section');
  if (!monthId) {
    return NextResponse.json({ error: 'month query param is required' }, { status: 400 });
  }

  const supabase = createClient();
  let query = supabase.from('financial_summary').select('*').eq('month_id', monthId);
  query = sectionId ? query.eq('section_id', sectionId) : query.is('section_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
