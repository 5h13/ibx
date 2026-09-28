// app/api/expenses/route.ts
//
// GET /api/expenses?section=finance&month=<month_id>
// Thin wrapper over the shared expenses service, for external/mobile
// consumers. Web UI pages call the service directly via server components
// instead of round-tripping through this route.

import { NextRequest, NextResponse } from 'next/server';
import { listExpenses } from '@/shared/expenses/service';
import type { SectionCode } from '@/core/auth/types';

export async function GET(req: NextRequest) {
  const section = req.nextUrl.searchParams.get('section') as SectionCode | null;
  const monthId = req.nextUrl.searchParams.get('month');

  if (!section || !monthId) {
    return NextResponse.json({ error: 'section and month query params are required' }, { status: 400 });
  }

  try {
    const rows = await listExpenses(section, monthId);
    return NextResponse.json({ data: rows });
  } catch (err: any) {
    // RLS will simply return an empty set for unauthorized rows rather than
    // throwing, so an error here is a real failure (bad section, etc).
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
