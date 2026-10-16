// Build 127 — the Sales Manager phone app's frame: the store's header (logo, colours), the
// calculator and a way back to the office app, the page, and the bottom bar. For Sales approvers
// and the Business Admin; the store is the one the user works in ("Acting as" for the Super Admin).
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionProfile } from '@/core/auth/getSessionProfile';
import { createClient } from '@/core/auth/supabaseServer';
import type { SessionProfile } from '@/core/auth/types';
import { canUseManagerApp } from './access';
import { parseTheme, themeCss, headerBackground } from '@/core/theme/brandTheme';
import { CalculatorButton } from '@/core/ui/Calculator';
import { ManagerNav } from './ManagerNav';

export async function managerProfile() {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (profile.user.must_change_password) redirect('/account/change-password');
  if (!canUseManagerApp(profile)) redirect('/dashboard');
  return profile;
}

export async function ManagerShell({ profile, title, sub, back, children, counts }: { profile: SessionProfile; title: string; sub?: string; back?: string; children: ReactNode; counts?: number }) {
  const db = createClient();
  const { data: biz } = profile.user.business_id
    ? await db.from('businesses').select('code,legal_name,trade_name,branding').eq('id', profile.user.business_id).maybeSingle()
    : { data: null };
  const br: any = (biz as any)?.branding ?? {};
  const theme = parseTheme(br.theme);
  const css = themeCss(theme);
  const bg = headerBackground(theme) ?? 'linear-gradient(90deg, #0f172a, #1e293b)';
  const fg = theme?.headerText ?? '#ffffff';
  const store = biz ? ((biz as any).trade_name || (biz as any).legal_name) : null;
  return (
    <div className="manager-app min-h-screen bg-slate-100 pb-24 md:pb-8">
      <meta name="theme-color" content={theme?.header ?? '#0f172a'} />
      {/* default button colour when the store has no theme; a theme's own values come after and win */}
      <style dangerouslySetInnerHTML={{ __html: ':root{--btn:15 118 110;--on-btn:255 255 255}' }} />
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <style dangerouslySetInnerHTML={{ __html: '@media (max-width: 767px){.manager-app .input{font-size:16px}}' }} />
      <header className="sticky top-0 z-30 shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
          {back ? (
            <Link href={back} aria-label="Back" className="flex h-11 w-11 flex-none items-center justify-center rounded-lg hover:bg-white/10">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </Link>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={br.logo_url || '/icons/icon-192.png'} alt="" className="h-9 w-9 flex-none rounded-lg bg-white object-contain" />
          )}
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-base font-extrabold">{title}</div>
            <div className="truncate text-xs opacity-80">{sub ?? `${store ?? 'Choose a store in "Acting as"'} · Sales Manager`}</div>
          </div>
          <CalculatorButton compact />
          <Link href="/dashboard" className="rounded-lg border border-white/30 px-2.5 py-1.5 text-xs font-semibold" title="Open the office app">Office</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-3 px-3 py-3 md:px-6">
        {profile.user.business_id ? children : <div className="rounded-xl border bg-white p-6 text-slate-600">Choose a store in &quot;Acting as&quot; (office app) to work in the Sales Manager app.</div>}
      </main>
      <ManagerNav approvals={counts ?? 0} />
    </div>
  );
}

/** The store's name, colours and logo (for the statement image). */
export async function storeBrand(profile: SessionProfile) {
  if (!profile.user.business_id) return { name: '', header: '#0f172a', text: '#ffffff', logo: null as string | null };
  const { data } = await createClient().from('businesses').select('legal_name,trade_name,branding').eq('id', profile.user.business_id).maybeSingle();
  const br: any = (data as any)?.branding ?? {};
  const t = parseTheme(br.theme);
  return { name: (data as any)?.trade_name || (data as any)?.legal_name || '', header: t?.header ?? '#0f172a', text: t?.headerText ?? '#ffffff', logo: (br.logo_url as string) ?? null };
}
