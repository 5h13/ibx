'use client';
// Build 102c / 104a — the installed app's launch screen: the full-bleed 5H13 logo on the blue → red background,
// with the name shimmering and a soft glow around the logo (gold → red → blue) while the app loads. Shown only when the app is opened from the
// phone's home screen (once per opening); it stays until the page has loaded (at least about a second, at most 8 s).
import { useEffect } from 'react';

export function LaunchScreen() {
  useEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains('ibx-launching')) return;
    const started = performance.now();
    let done = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const finish = () => {
      if (done) return; done = true;
      const wait = Math.max(0, 1200 - (performance.now() - started));
      timers.push(setTimeout(() => html.classList.add('ibx-launch-out'), wait));
      timers.push(setTimeout(() => html.classList.remove('ibx-launching', 'ibx-launch-out'), wait + 400));
    };
    if (document.readyState === 'complete') finish(); else window.addEventListener('load', finish, { once: true });
    timers.push(setTimeout(finish, 8000));
    return () => { window.removeEventListener('load', finish); timers.forEach(clearTimeout); };
  }, []);
  return (
    <div className="ibx-launch" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="ibx-launch-logo"><img src="/icons/launch-logo.png" alt="" /></div>
      <div className="ibx-launch-name"><span>5H13 Business Solutions</span></div>
    </div>
  );
}
