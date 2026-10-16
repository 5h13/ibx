// Build 95 — the agent app's frame (phone first). The store picked at the top is
// the agent's highest-level switch: the colours, logo, clients, catalogue,
// prices, orders, quotations, payments, expenses and commission all follow it,
// and everything he records is recorded in that store.
import { redirect } from 'next/navigation';
import { displayName } from '@/core/auth/loginEmail';
import { WelcomeGreeting } from '@/core/ui/WelcomeGreeting';
import type { ReactNode } from 'react';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { createClient } from '@/core/auth/supabaseServer';
import { parseTheme, themeCss, headerBackground } from '@/core/theme/brandTheme';
import type { AgentContext } from './agentContext';
import { AgentNav, AgentStoreSwitch, InstallButton, AgentMenu, AgentNotices, ResumeLastScreen } from './AgentShellClient';
import { Suspense } from 'react';
import { AgentNotLinked } from './AgentHeader';
import { CalculatorButton } from '@/core/ui/Calculator';

export async function AgentShell({ ctx, title, hint, children }: { ctx: AgentContext; title: string; hint?: string; children?: ReactNode }) {
  if (ctx.profile.user.must_change_password) redirect('/account/change-password');
  // the chosen store's branding (read after the agent check in getAgentContext; agents cannot read other stores' rows)
  let theme = null as ReturnType<typeof parseTheme>;
  let logo: string | null = null;
  if (ctx.store) {
    const { data } = await createAdminClient().from('businesses').select('branding').eq('id', ctx.store.business_id).maybeSingle();
    const br: any = data?.branding ?? {};
    theme = parseTheme(br.theme);
    logo = br.logo_url ?? null;
  }
  // Build 96: notices to the agent (clients moved to / away from him), all stores
  const { data: notices } = ctx.agentId ? await createClient().rpc('agent_notifications') : { data: null };
  const css = themeCss(theme);
  const bg = headerBackground(theme) ?? 'linear-gradient(90deg, #0f172a, #1e293b)';
  const fg = theme?.headerText ?? '#ffffff';   // the store's own "Header & sidebar text" colour
  const bar = theme?.header ?? '#0f172a';        // phone status bar / installed app bar
  return (
    <div className="agent-app min-h-screen bg-slate-50 pb-24 md:pb-8">
      <meta name="theme-color" content={bar} />
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      {/* phones: 16px inputs so iOS does not zoom in on every field */}
      <style dangerouslySetInnerHTML={{ __html: '@media (max-width: 767px){.agent-app .input{font-size:16px}}' }} />
      <header className="sticky top-0 z-30 shadow" style={{ background: bg, color: fg, paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo || '/icons/icon-192.png'} alt="" className="h-9 w-9 flex-none rounded-lg bg-white object-contain" />
          <div className="min-w-0 flex-1">
            <AgentStoreSwitch stores={ctx.stores} store={ctx.store} />
          </div>
          <InstallButton />
          <CalculatorButton compact />
          <AgentNotices data={(notices as any) ?? { unread: 0, items: [] }} />
          <AgentMenu name={displayName(ctx.profile.user)} office={ctx.profile.user.role !== 'agent'} />
        </div>
        <AgentNav variant="tabs" />
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 md:px-6">
        <div>
          <h1 className="text-lg font-semibold md:text-xl">{title}</h1>
          {hint && <p className="mt-0.5 text-xs text-slate-500 md:text-sm">{hint}</p>}
        </div>
        {ctx.store ? children : <AgentNotLinked message={ctx.error ?? 'No store is open for agents yet.'} />}
      </main>
      <AgentNav variant="bottom" />
      <WelcomeGreeting name={ctx.profile.user.welcome_name} userId={ctx.profile.user.id} />
      <Suspense fallback={null}><ResumeLastScreen /></Suspense>
    </div>
  );
}
