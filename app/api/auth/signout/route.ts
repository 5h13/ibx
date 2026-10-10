// app/api/auth/signout/route.ts
//
// POST /api/auth/signout — clears the session cookie server-side.
// Sign-in itself goes straight through the Supabase client
// (see app/login/page.tsx) — Supabase Auth issues its own tokens,
// so there's no separate /api/auth/login handler to write.
//
// Build 95b: back to the login page on the same site the user is on (the
// live Vercel address, a phone with the installed app, or localhost in
// development) — no longer a fixed address. 303 so the browser opens the
// login page with a normal GET after the POST.

import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/core/auth/supabaseServer';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), 303);
}
