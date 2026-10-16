'use client';
// Build 117 — "Install app" for the office screens (computer and phone). Chrome / Edge offer the install
// prompt once the page has the app manifest and the service worker; iPhone gets the Add to Home Screen steps.
import { useEffect, useState } from 'react';

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export function InstallAppButton({ className = '', full = false }: { className?: string; full?: boolean }) {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    setInstalled(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    const onInstalled = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  if (installed || (!evt && !ios)) return null;
  const click = async () => {
    if (evt) { await evt.prompt(); const r = await evt.userChoice; if (r.outcome === 'accepted') setInstalled(true); setEvt(null); }
    else setHelp(true);
  };
  return (
    <>
      <button type="button" onClick={click} title="Install 5H13 as an app on this computer or phone"
        className={className || (full ? 'button w-full' : 'rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800')}>
        ⤓ Install app
      </button>
      {help && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 text-slate-800 sm:items-center" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm space-y-2 rounded-xl bg-white p-4 text-sm" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-semibold">Install 5H13 on your iPhone</h2>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Open this page in <b>Safari</b>.</li>
              <li>Tap the <b>Share</b> button (square with an arrow up).</li>
              <li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li>
            </ol>
            <button type="button" className="button w-full" onClick={() => setHelp(false)}>OK</button>
          </div>
        </div>
      )}
    </>
  );
}

/** Registers the service worker on every page so the browser treats any 5H13 page as installable. */
export function ServiceWorkerRegister() {
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
  return null;
}
