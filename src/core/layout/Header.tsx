// src/core/layout/Header.tsx
import type { SessionProfile } from '@/core/auth/types';
import { ActingBusinessSwitcher } from './ActingBusinessSwitcher';
import { RoleAuditSwitcher } from './RoleAuditSwitcher';
import { NotificationBell } from '@/shared/notifications/NotificationBell';
import { parseTheme, headerBackground } from '@/core/theme/brandTheme';

type Branding = { primary_color?: string; logo_url?: string };
type Business = { id: string; code: string; legal_name: string; trade_name: string | null; branding?: Branding | null };
type Notification = { id: string; title: string; message: string | null; action_url: string | null; read_at: string | null; created_at: string };

// U033 — Business Branding. `branding` is a free-form jsonb column
// (20261012_a001_multi_business_foundation.sql); this reads only the two
// keys the new Business Branding admin page (U033) writes, and tolerates
// every other shape (empty object, or keys from before this feature) by
// just falling back to the plain, unbranded header it always showed.
function accentColor(branding: Branding | null | undefined): string | null {
  const c = branding?.primary_color;
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null;
}

export function Header({ profile, businesses = [], notifications = [] }: { profile: SessionProfile; businesses?: Business[]; notifications?: Notification[] }) {
  const actingBusiness = businesses.find((b) => b.id === profile.user.business_id);
  const accent = accentColor(actingBusiness?.branding);
  const logoUrl = actingBusiness?.branding?.logo_url;
  const theme = parseTheme((actingBusiness?.branding as any)?.theme);
  const tagline = (actingBusiness?.branding as any)?.tagline as string | undefined;
  const bizName = actingBusiness ? actingBusiness.trade_name || actingBusiness.legal_name : null;
  return (
    <header
      className="bg-slate-900 text-white shadow-md"
      style={{ ...(theme ? { background: headerBackground(theme) } : {}), ...(accent && !theme ? { borderBottom: `3px solid ${accent}` } : {}) }}
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={`${bizName ?? ''} logo`} className="h-12 w-12 rounded-xl object-contain" />
          )}
          {bizName && (theme || logoUrl) ? (
            <div className="leading-tight">
              <h1 className="text-xl font-extrabold uppercase tracking-wide">{bizName}</h1>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-300">{tagline || '5H13 Business Solutions'}</p>
              {profile.user.role === 'super_admin' && <p className="text-[10px] uppercase tracking-wide text-slate-400">Acting as this business</p>}
            </div>
          ) : (
            <div>
              <h1 className="text-xl font-bold tracking-wide">5H13 BUSINESS SOLUTIONS</h1>
              <p className="text-xs text-slate-400">
                {profile.user.role === 'super_admin'
                  ? bizName ? `Acting as ${bizName}` : 'Commission & Sales Management System'
                  : bizName ?? 'Commission & Sales Management System'}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-300">
          {profile.user.role === 'super_admin' && (
            <ActingBusinessSwitcher businesses={businesses} actingBusinessId={profile.user.business_id} />
          )}
          {/* Build 57 — role audit: real Super Admin / Business Admin, not already auditing */}
          {!profile.audit && (profile.user.role === 'super_admin' || profile.user.role === 'business_admin') && (
            <RoleAuditSwitcher isSuperAdmin={profile.user.role === 'super_admin'} businesses={businesses} defaultBusinessId={profile.user.business_id} />
          )}
          <NotificationBell notifications={notifications} />
          <span>
            {profile.user.full_name ?? profile.user.email} &middot;{' '}
            <span className="uppercase text-slate-400">{profile.user.role}</span>
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
      </div>
    </header>
  );
}
