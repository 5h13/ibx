// app/api/sales/route.ts
//
// GET /api/sales?month=<month_id>

import { NextRequest, NextResponse } from 'next/server';
import { listSalesEntries } from '@/shared/sales/service';

export async function GET(req: NextRequest) {
  const monthId = req.nextUrl.searchParams.get('month');
  if (!monthId) {
    return NextResponse.json({ error: 'month query param is required' }, { status: 400 });
  }
  try {
    const rows = await listSalesEntries(monthId);
    return NextResponse.json({ data: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
