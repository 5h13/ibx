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
      <div className="ibx-launch" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="" />
        <div className="ibx-launch-name">5H13 Business Solutions</div>
      </div>
    </>
  );
}
