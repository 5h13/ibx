// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

// Build 139 — clickjacking guard (from 5h13Shops Build 4.1): only the public shop (/shop/...) may be shown inside
// another website; every other page (sign-in, staff, finance, HR…) refuses to load in another site's frame.
// SAMEORIGIN (not DENY): the app itself frames its own Banner Studio and Specs Card (/marketing-tools).
function noFraming<T extends NextResponse>(res: T): T {
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  res.headers.set('Content-Security-Policy', "frame-ancestors 'self'");
  return res;
}
const isShopPath = (p: string) => p === '/shop' || p.startsWith('/shop/');

export async function proxy(request: NextRequest) {
  const res = await route(request);
  return isShopPath(request.nextUrl.pathname) ? res : noFraming(res);
}

async function route(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request: { headers: request.headers } });

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: CookieOptions) {
            response.cookies.set({ name, value, ...options });
          },
          remove(name: string, options: CookieOptions) {
            response.cookies.set({ name, value: '', ...options });
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // Allow login page always
    // Build 136: the public online shops (/shop, /shop/<store>) are open to everyone
    if (isShopPath(request.nextUrl.pathname)) {
      return response;
    }
    if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname.startsWith('/auth/')) {
      return response; // /auth/accept: invitation / reset links, before the user has a session
    }

    // If no user, redirect to login
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    return response;
  } catch (err) {
    console.error('Middleware error:', err);
    // Fail open instead of crashing
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|icons/|fonts/|manifest.webmanifest|sw.js|offline.html|ocr/|ai/).*)'], // Build 119: /ocr = the on-device text reader files // Build 141: /ai = the photo touch-up's background remover (about 16 MB) // /brand: public logo files (login page); Build 95: app install files
};