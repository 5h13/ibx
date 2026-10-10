'use client';
// Build 102c — the installed app's launch screen: the 5H13 logo on the blue → red background.
// Shown only when the app is opened from the phone's home screen (once per opening), then fades out.
import { useEffect } from 'react';

export function LaunchScreen() {
  useEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains('ibx-launching')) return;
    const t1 = setTimeout(() => html.classList.add('ibx-launch-out'), 900);
    const t2 = setTimeout(() => html.classList.remove('ibx-launching', 'ibx-launch-out'), 1300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
.ibx-launch{display:none}
html.ibx-launching .ibx-launch{display:flex;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#0a37a6 0%,#0a37a6 50%,#3d3f9a 60%,#7d4479 75%,#c21d36 100%);transition:opacity .4s ease}
html.ibx-launch-out .ibx-launch{opacity:0;pointer-events:none}
.ibx-launch img{width:120px;height:120px;border-radius:26px;box-shadow:0 10px 30px rgba(0,0,0,.25)}` }} />
      <div className="ibx-launch" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="" />
      </div>
    </>
  );
}
