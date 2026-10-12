'use client';
// Build 108 — phone frame: tables with class "m-cards" show as cards on a phone (CSS in app/globals.css).
// This copies each column heading into the row cells (data-label) so every value in a card is labelled, and marks:
//   data-m="title"   the card heading — the first cell, or the column number given on the table as data-m-title
//   data-m="actions" the last cell when its heading is "Action(s)", "Decision" or blank (shown as a row of buttons)
//   data-m="full"    a single cell spanning the row ("No items yet")
// It runs again whenever the page changes, so filtered and newly loaded rows are labelled too.
import { useEffect } from 'react';

const ACTIONS = /^(actions?|decision|)$/i;

function label(t: HTMLTableElement) {
  const head = t.tHead?.rows[0];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) {
    const n = (th.textContent || '').trim();
    for (let k = 0; k < (th.colSpan || 1); k++) names.push(n);
  }
  const titleCol = Number(t.getAttribute('data-m-title') ?? 0) || 0;
  const bodies = [...Array.from(t.tBodies), ...(t.tFoot ? [t.tFoot] : [])];
  for (const body of bodies) {
    for (const tr of Array.from(body.rows)) {
      const cells = Array.from(tr.cells);
      let col = 0;
      cells.forEach((td, i) => {
        const span = td.colSpan || 1;
        const n = span === 1 ? names[col] ?? '' : '';
        if (td.getAttribute('data-label') !== n) td.setAttribute('data-label', n);
        const role = cells.length === 1 && span > 1 ? 'full'
          : col === titleCol && span === 1 ? 'title'
          : i === cells.length - 1 && i > 0 && ACTIONS.test(n) ? 'actions' : '';
        if ((td.getAttribute('data-m') || '') !== role) {
          if (role) td.setAttribute('data-m', role); else td.removeAttribute('data-m');
        }
        col += span;
      });
    }
  }
}

export function MobileTableLabels() {
  useEffect(() => {
    let raf = 0;
    const run = () => { raf = 0; document.querySelectorAll<HTMLTableElement>('table.m-cards').forEach(label); };
    run();
    const mo = new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run); });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => { mo.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return null;
}
