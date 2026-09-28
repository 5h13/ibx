// app/api/auth/signout/route.ts
//
// POST /api/auth/signout — clears the session cookie server-side.
// Sign-in itself goes straight through the Supabase client
// (see app/login/page.tsx) — Supabase Auth issues its own tokens,
// so there's no separate /api/auth/login handler to write.

import { NextResponse } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function POST() {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'));
}
