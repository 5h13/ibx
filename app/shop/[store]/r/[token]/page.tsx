// Build 139 (from 5h13Shops Build 10): the buyer's private request page (link shown after "Send request"): what they
// sent, whether the store has seen it, and the store's answer (Confirmed / Not available / Done + a note).
// Not listed anywhere; not indexed by search engines.
import { notFound } from 'next/navigation';
import { ShopShell } from '@/modules/shop/ShopShell';
import { loadStore, pesoShop, viberIntl } from '@/modules/shop/data';
import { createClient } from '@/core/auth/supabaseServer';
import { RequestContact } from '@/modules/shop/RequestContact';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your request', robots: { index: false, follow: false } };

type R = { number: number; kind: string; title: string; total: number | null; status: string; reply_note: string | null; contact_via: string; buyer_name: string; message: string; created_at: string; updated_at: string; slug: string };
const STEPS: Record<string, { label: string; tone: string; text: string }> = {
  new: { label: 'Sent', tone: 'bg-sky-50 text-sky-900', text: 'The store has your request. They will contact you soon.' },
  seen: { label: 'Seen by the store', tone: 'bg-sky-50 text-sky-900', text: 'The store has seen your request and will contact you.' },
  confirmed: { label: 'Confirmed ✓', tone: 'bg-emerald-50 text-emerald-900', text: 'The store confirmed your request.' },
  unavailable: { label: 'Not available', tone: 'bg-amber-50 text-amber-900', text: 'Sorry — the store can’t do this request right now.' },
  done: { label: 'Done', tone: 'bg-slate-100 text-slate-800', text: 'The store marked this request as done. Thank you!' },
};

export default async function RequestPage(props: { params: Promise<{ store: string; token: string }> }) {
  const { store: slug, token } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const [store, { data }] = await Promise.all([loadStore(slug), createClient().rpc('shop_request_status', { p_token: token })]);
  const r = data as R | null;
  if (!store || !r || r.slug !== store.slug) notFound();
  const step = STEPS[r.status] ?? STEPS.new;
  const order = ['new', 'seen', r.status === 'unavailable' ? 'unavailable' : 'confirmed'];
  const reached = (k: string) => k === 'new' || (k === 'seen' && r.status !== 'new') || k === r.status || (k === 'confirmed' && r.status === 'done');
  return (
    <ShopShell store={store} back={`/shop/${slug}`}>
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-xl font-extrabold">Request #{r.number}</h1>
        <p className="text-sm text-slate-500">{r.title}{r.total != null ? ` · ${pesoShop(r.total)}` : ''} · sent {new Date(r.created_at).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })}</p>
        <ol className="flex gap-2" aria-label="Progress">
          {order.map((k) => <li key={k} className={`flex-1 rounded-full py-1.5 text-center text-xs font-bold ${reached(k) ? 'bg-[rgb(var(--btn))] text-[rgb(var(--on-btn))]' : 'bg-slate-200 text-slate-500'}`}>{STEPS[k].label}</li>)}
        </ol>
        <section className={`rounded-2xl p-4 ${step.tone}`} data-testid="request-status">
          <b className="block text-lg">{step.label}</b>
          <p className="text-sm">{step.text}</p>
          {r.reply_note && <p className="mt-2 rounded-xl bg-white/70 p-3 text-[15px]"><b>From the store:</b> {r.reply_note}</p>}
        </section>
        <RequestContact number={r.number} name={r.buyer_name} messenger={store.messenger_url} viber={viberIntl(store.viber_number)} whatsapp={store.whatsapp_number ?? null} phone={store.phone} />
        <details className="rounded-2xl bg-white p-4 shadow-sm"><summary className="cursor-pointer text-sm font-bold">What you sent</summary><pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{r.message}</pre></details>
        <p className="text-xs text-slate-500">Keep this page: bookmark it or save the link. Only people with this link can see it.</p>
      </div>
    </ShopShell>
  );
}
