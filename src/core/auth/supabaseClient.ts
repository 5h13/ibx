// src/core/auth/supabaseClient.ts
//
// Browser-side Supabase client. Server components/route handlers should use
// a server client instead (see supabaseServer.ts) so cookies are handled
// correctly — this one is for client components only.

import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
