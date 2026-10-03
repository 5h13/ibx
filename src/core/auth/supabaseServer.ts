// src/core/auth/supabaseServer.ts
//
// Server-side Supabase client (route handlers, server components, server
// actions). Reads the session from cookies set by @supabase/ssr during login.
//
// Build 83 (Next.js 16): cookies() is asynchronous. The client stays
// synchronous for its callers (createClient() is used in ~115 places): the
// cookie store promise is awaited inside the cookie callbacks, which
// @supabase/ssr supports.
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

export function createClient() {
  const store = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return (await store).getAll();
        },
        async setAll(list: { name: string; value: string; options: CookieOptions }[]) {
          try {
            const s = await store;
            for (const { name, value, options } of list) s.set(name, value, options);
          } catch {
            // Server Components cannot set cookies; the proxy refreshes the session.
          }
        },
      },
    }
  );
}
