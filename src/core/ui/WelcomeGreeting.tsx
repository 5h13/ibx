'use client';
// Build 104 — a personal greeting after sign-in (owner's request for the 5H13 account): "Good morning / afternoon /
// evening <name>!" by Manila time, once per sign-in session, fading after a few seconds.
import { useEffect, useState } from 'react';

export function WelcomeGreeting({ name, userId }: { name: string | null | undefined; userId: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!name) return;
    const key = `ibx-welcomed:${userId}`;
    try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* storage off: show anyway */ }
    const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Manila' }).format(new Date()));
    setText(`Good ${h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'} ${name}!`);
    const t = setTimeout(() => setText(''), 6000);
    return () => clearTimeout(t);
  }, [name, userId]);
  if (!text) return null;
  return (
    <div className="fixed inset-x-0 top-20 z-[60] flex justify-center px-4" role="status">
      <button type="button" onClick={() => setText('')} className="rounded-2xl px-6 py-4 text-xl font-semibold text-white shadow-xl"
        style={{ background: 'linear-gradient(90deg, #0038a8, #ce1126)' }}>{text}</button>
    </div>
  );
}
