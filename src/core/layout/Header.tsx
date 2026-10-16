// src/core/layout/Header.tsx
import { displayName } from '@/core/auth/loginEmail';
import type { SessionProfile } from '@/core/auth/types';
import { ActingBusinessSwitcher } from './ActingBusinessSwitcher';
import { MobileAccountMenu } from './MobileAccountMenu';
import { RoleAuditSwitcher } from './RoleAuditSwitcher';
import { NotificationBell } from '@/shared/notifications/NotificationBell';
import { InstallAppButton } from '@/core/ui/InstallAppButton';
import { parseTheme, headerBackground, THEME_PRESETS } from '@/core/theme/brandTheme';

type Branding = { primary_color?: string; logo_url?: string };
type Business = { id: string; code: string; legal_name: string; trade_name: string | null; branding?: Branding | null };
type Notification = { id: string; title: string; message: string | null; action_url: string | null; read_at: string | null; created_at: string };

// U033 — Business Branding. `branding` is a free-form jsonb column
// (20261012_a001_multi_business_foundation.sql); this reads only the two
// keys the new Business Branding admin page (U033) writes, and tolerates
// every other shape (empty object, or keys from before this feature) by
// just falling back to the plain, unbranded header it always showed.
// Build 108: the role written as words ("business_admin" → "Business Admin")
export function roleName(role: string): string {
  if (role === 'super_admin') return '5H13 Super Admin';
  return role.split('_').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

function accentColor(branding: Branding | null | undefined): string | null {
  const c = branding?.primary_color;
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

export function Header({ profile, businesses = [], notifications = [], agentApp = false }: { profile: SessionProfile; businesses?: Business[]; notifications?: Notification[]; agentApp?: boolean }) {
  const actingBusiness = businesses.find((b) => b.id === profile.user.business_id);
  const accent = accentColor(actingBusiness?.branding);
  const logoUrl = actingBusiness?.branding?.logo_url;
  // 5H13 level (no store chosen): 5H13 logo and the PH-accent theme.
  const theme = actingBusiness ? parseTheme((actingBusiness?.branding as any)?.theme) : THEME_PRESETS.ph.theme;
  const tagline = (actingBusiness?.branding as any)?.tagline as string | undefined;
  const bizName = actingBusiness ? actingBusiness.trade_name || actingBusiness.legal_name : null;
  return (
    <header
      className="bg-slate-900 text-white shadow-md"
      style={{ ...(theme ? { background: headerBackground(theme) } : {}), ...(accent && !theme ? { borderBottom: `3px solid ${accent}` } : {}) }}
    >
      {/* Build 108: one row on a phone — brand on the left (clear of the menu button), bell and account button on the right */}
      <div className="max-w-7xl mx-auto py-3 pl-14 pr-3 md:px-4 flex justify-between items-center gap-3 md:gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${bizName ?? ''} logo`} className="h-10 w-10 shrink-0 rounded-xl object-contain md:h-12 md:w-12" />
          )}
          {bizName && (theme || logoUrl) ? (
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-sm font-extrabold uppercase tracking-normal sm:text-base md:text-xl md:tracking-wide">{bizName}</h1>
              <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-300 md:text-[11px]">{tagline || '5H13 Business Solutions'}</p>
              {profile.user.role === 'super_admin' && <p className="text-[10px] uppercase tracking-wide text-slate-400">Acting as this business</p>}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              {!actingBusiness && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/brand/5h13-logo.jpg" alt="5H13" className="h-10 w-10 shrink-0 rounded-xl object-cover shadow md:h-12 md:w-12" />
              )}
              <div className="min-w-0 leading-tight">
                <h1 className="truncate text-sm font-extrabold tracking-normal sm:text-base md:text-xl md:tracking-wide">5H13 BUSINESS SOLUTIONS</h1>
                <p className="truncate text-[10px] font-semibold uppercase tracking-widest md:text-xs" style={!actingBusiness ? { color: '#fcd116' } : undefined}>
                  {profile.user.role === 'super_admin' && bizName ? `Acting as ${bizName}` : bizName ?? 'Business Management System'}
                </p>
              </div>
            </div>
          )}
        </div>
        <div className="hidden md:flex flex-wrap items-center justify-end gap-3 text-sm text-slate-300">
          {profile.user.role === 'super_admin' && (
            <ActingBusinessSwitcher businesses={businesses} actingBusinessId={profile.user.business_id} />
          )}
          {/* Build 57 — role audit: real Super Admin / Business Admin, not already auditing */}
          {!profile.audit && (profile.user.role === 'super_admin' || profile.user.role === 'business_admin') && (
            <RoleAuditSwitcher isSuperAdmin={profile.user.role === 'super_admin'} businesses={businesses} defaultBusinessId={profile.user.business_id} />
          )}
          {agentApp && <a href="/agent" className="rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800" title="Open the agent app (your clients, catalogue, orders and commission)">Agent app</a>}
          <InstallAppButton />
          <NotificationBell notifications={notifications} />
          <span>
            <a href="/profile" className="hover:underline" title="My profile">{displayName(profile.user)}</a> &middot;{' '}
            <span className="text-slate-400">{roleName(profile.user.role)}</span>
          </span>
          <form action="/api/auth/signout" method="post">
            <button
              type="submit"
              className="border border-slate-600 rounded px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 hover:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              Logout
            </button>
          </form>
        </div>
        <div className="flex shrink-0 items-center gap-2 md:hidden">
          <NotificationBell notifications={notifications} compact />
          <MobileAccountMenu name={displayName(profile.user)} role={roleName(profile.user.role)}>
            {profile.user.role === 'super_admin' && (
              <div className="[&_label]:flex-wrap [&_select]:w-full"><ActingBusinessSwitcher businesses={businesses} actingBusinessId={profile.user.business_id} /></div>
            )}
            {!profile.audit && (profile.user.role === 'super_admin' || profile.user.role === 'business_admin') && (
              <RoleAuditSwitcher isSuperAdmin={profile.user.role === 'super_admin'} businesses={businesses} defaultBusinessId={profile.user.business_id} alignLeft />
            )}
            <div className="grid gap-2">
              <InstallAppButton full />
              {agentApp && <a href="/agent" className="button text-center">Agent app</a>}
              <a href="/profile" className="button-secondary text-center">My profile</a>
              <form action="/api/auth/signout" method="post"><button type="submit" className="button-secondary w-full">Logout</button></form>
            </div>
          </MobileAccountMenu>
        </div>
      </div>
      {!actingBusiness && <div aria-hidden className="h-1 w-full" style={{ background: 'linear-gradient(90deg, #fcd116 0%, #fcd116 33%, #0038a8 33%, #0038a8 66%, #ce1126 66%, #ce1126 100%)' }} />}
    </header>
  );
}
