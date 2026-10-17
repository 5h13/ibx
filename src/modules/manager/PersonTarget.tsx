'use client';
// Build 132 — change a person's target from their page (with the note that is sent to them).
import { useState } from 'react';
import { TargetEditor } from './TeamTargets';

export function PersonTarget({ year, month, agent, user, current, suggested, who }: { year: number; month: number; agent: string | null; user: string | null; current: number | null; suggested: number | null; who: string }) {
  const [open, setOpen] = useState(false);
  return open
    ? <TargetEditor year={year} month={month} agent={agent} user={user} current={current} suggested={suggested} who={who} onDone={() => setOpen(false)} />
    : <button type="button" className="text-xs font-bold text-[rgb(var(--btn))] underline" onClick={() => setOpen(true)}>Change target</button>;
}
