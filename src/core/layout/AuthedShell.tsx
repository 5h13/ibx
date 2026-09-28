// src/core/layout/AuthedShell.tsx
import type { ReactNode } from 'react';
import type { SessionProfile } from '@/core/auth/types';
import { createClient } from '@/core/auth/supabaseServer';
import { Header } from './Header';
import { RoleAuditBanner } from './RoleAuditBanner';
import { ResponsiveNav } from './ResponsiveNav';
import { listMyNotificationsAction } from '@/shared/notifications/service';
import { parseTheme, themeCss } from '@/core/theme/brandTheme';

export async function AuthedShell({ profile, children }: { profile: SessionProfile; children: ReactNode }) {
  // A001 completion: only the Global Super Admin needs the acting-business
  // switcher, and only they can read every row of `businesses` (RLS scopes
  // everyone else to their own). Fetching here — once, in the shared shell
  // — means no individual page had to be touched to support this.
  //
  // U033 (Business Branding): every user's own business's branding should be
  // visible, not only when the Global Super Admin is acting as one, so this
  // now fetches for every role — RLS ("businesses read own or global admin")
  // scopes a non-super-admin's read to exactly their own business row.
  const db = createClient();
  const { data } = await db.from('businesses').select('id,code,legal_name,trade_name,branding').eq('is_active', true).order('trade_name');
  const businesses = data ?? [];

  // U006: fetched once here (same rationale as `businesses` above) so no
  // individual page needs to know about notifications for the bell to work
  // everywhere the shell renders.
  const notifications = await listMyNotificationsAction().catch(() => []);

  // Build 63 — the store's theme (businesses.branding.theme) re-colours the
  // whole app for everyone working in that business (and for the Super Admin
  // while "Acting as" it). No theme = the original look.
  const actingBusiness: any = businesses.find((b: any) => b.id === profile.user.business_id);
  const css = themeCss(parseTheme(actingBusiness?.branding?.theme));

  return (
    // Independent scrolling (md+): the shell fills exactly the viewport as a
    // column — header on top, then a row whose two children each scroll on
    // their own: the sidebar (ResponsiveNav) and the page content (<main>).
    // Scrolling a long page no longer drags the menu away, and a long menu
    // scrolls without moving the page. Below md the page scrolls normally
    // and the sidebar is the off-canvas drawer (also independently scrollable).
    <div className="min-h-screen bg-slate-50 md:h-screen md:min-h-0 md:flex md:flex-col md:overflow-hidden">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <div className="md:shrink-0">
        {profile.audit && (
          <RoleAuditBanner
            audit={profile.audit}
            businessName={(() => { const b = businesses.find((x: any) => x.id === profile.audit!.businessId); return b ? (b.trade_name || b.legal_name) : 'selected business'; })()}
          />
        )}
        <Header profile={profile} businesses={businesses} notifications={notifications} />
      </div>
      <div className="flex md:flex-1 md:min-h-0">
        <ResponsiveNav profile={profile} />
        <main className="flex-1 min-w-0 md:overflow-y-auto">
          {/* U035: extra top padding on mobile clears the fixed hamburger button ResponsiveNav renders there. */}
          <div className="max-w-5xl mx-auto p-6 pt-16 md:pt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
