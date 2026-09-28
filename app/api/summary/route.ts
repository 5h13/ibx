// app/api/summary/route.ts
//
// GET /api/summary?month=<month_id>&section=<section_id optional>&business=<business_id, required for Super Admin>
// section omitted = company-wide row (section_id is null).
//
// U002 follow-on fix: financial_summary is business-scoped under A001 (one
// row per business per section per month). A scoped caller (business_admin/
// staff) is narrowed to their own business automatically; a Global Super
// Admin has no single business, so without an explicit `business` param
// this returned every business's row to a single `.maybeSingle()` call and
// crashed once more than one business had data for the same month --
// exactly the bug found on /dashboard. This route is not currently called
// from anywhere in the app, but is fixed here to the same standard rather
// than left as a dormant landmine.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { isSuperAdmin } from '@/core/auth/types';

export async function GET(req: NextRequest) {
  const monthId = req.nextUrl.searchParams.get('month');
  const sectionId = req.nextUrl.searchParams.get('section');
  const businessParam = req.nextUrl.searchParams.get('business');
  if (!monthId) {
    return NextResponse.json({ error: 'month query param is required' }, { status: 400 });
  }

  const profile = await getSessionProfile();
  if (!profile) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const supabase = createClient();
  let query = supabase.from('financial_summary').select('*').eq('month_id', monthId);
  query = sectionId ? query.eq('section_id', sectionId) : query.is('section_id', null);

  if (isSuperAdmin(profile)) {
    if (businessParam) {
      const { data, error } = await query.eq('business_id', businessParam).maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ data });
    }
    // No business specified: return every business's row rather than risk
    // the multi-row .maybeSingle() crash.
    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data });
  }

  const { data, error } = await query.eq('business_id', profile.user.business_id ?? '').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
