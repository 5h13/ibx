'use client';
// Build 126 (UIA-26) — a pull-out calculator anywhere in the app (office header, phone menu bar, agent
// app). Floating panel (drag it aside on a PC; slides up on a phone), keyboard input, a tape of recent
// calculations kept on this device, and "Use" puts the result into the field last selected.
// Business keys: VAT 12% add / remove, discount %, markup % (cost → price) and margin (price vs cost).
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const VAT = 0.12;
const TAPE_KEY = 'ibx.calculator.tape';
type Op = '+' | '-' | '×' | '÷' | 'disc' | 'markup' | 'margin';
const OP_LABEL: Record<Op, string> = { '+': '+', '-': '−', '×': '×', '÷': '÷', disc: 'less discount %', markup: 'plus markup %', margin: 'margin vs cost' };

// The field last selected outside the calculator, for "Use".
let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;
function trackFields() {
  if (typeof document === 'undefined' || (window as any).__ibxCalcTrack) return;
  (window as any).__ibxCalcTrack = true;
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest('[data-ibx-calculator]')) return;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && ['text', 'number', 'search', 'tel', ''].includes(t.type))) {
      if (!(t as HTMLInputElement).readOnly && !(t as HTMLInputElement).disabled) lastField = t as any;
    }
  });
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : 'Error');
const fix = (n: number) => Math.round(n * 1e10) / 1e10;

function loadTape(): string[] { try { return JSON.parse(localStorage.getItem(TAPE_KEY) || '[]').slice(0, 30); } catch { return []; } }
function saveTape(t: string[]) { try { localStorage.setItem(TAPE_KEY, JSON.stringify(t.slice(0, 30))); } catch { /* storage unavailable */ } }

export function CalculatorButton({ compact = false, className = '' }: { compact?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); trackFields(); }, []);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} title="Calculator" aria-label="Calculator"
        className={className || (compact ? 'rounded border border-white/30 px-2 py-1 text-base leading-none' : 'rounded border border-slate-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800')}>
        {compact ? '🧮' : '🧮 Calculator'}
      </button>
      {mounted && open && createPortal(<CalculatorPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function CalculatorPanel({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState('0');      // what is being typed / the result shown
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<Op | null>(null);
  const [fresh, setFresh] = useState(true);         // the next digit starts a new number
  const [note, setNote] = useState('');
  const [tape, setTape] = useState<string[]>([]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [isPhone, setIsPhone] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    setTape(loadTape());
    const mq = window.matchMedia('(max-width: 767px)');
    const set = () => setIsPhone(mq.matches);
    set(); mq.addEventListener('change', set);
    setPos({ x: Math.max(16, window.innerWidth - 360), y: 80 });
    panel.current?.focus();
    return () => mq.removeEventListener('change', set);
  }, []);

  const value = () => Number(display.replace(/,/g, ''));
  const log = useCallback((line: string) => { setTape((t) => { const n = [line, ...t].slice(0, 30); saveTape(n); return n; }); }, []);
  const show = (n: number) => { setDisplay(String(fix(n))); setFresh(true); };

  function digit(d: string) {
    setNote('');
    if (fresh) { setDisplay(d === '.' ? '0.' : d); setFresh(false); return; }
    if (d === '.' && display.includes('.')) return;
    setDisplay(display === '0' && d !== '.' ? d : display + d);
  }
  function apply(a: number, o: Op, b: number): { result: number; line: string } {
    switch (o) {
      case '+': return { result: a + b, line: `${fmt(a)} + ${fmt(b)}` };
      case '-': return { result: a - b, line: `${fmt(a)} − ${fmt(b)}` };
      case '×': return { result: a * b, line: `${fmt(a)} × ${fmt(b)}` };
      case '÷': return { result: b === 0 ? NaN : a / b, line: `${fmt(a)} ÷ ${fmt(b)}` };
      case 'disc': return { result: a * (1 - b / 100), line: `${fmt(a)} less ${fmt(b)}% discount` };
      case 'markup': return { result: a * (1 + b / 100), line: `cost ${fmt(a)} + ${fmt(b)}% markup` };
      case 'margin': return { result: a === 0 ? NaN : ((a - b) / a) * 100, line: `price ${fmt(a)} vs cost ${fmt(b)} → margin %` };
    }
  }
  function operator(o: Op) {
    const v = value();
    if (op && acc != null && !fresh) {
      const r = apply(acc, op, v); log(`${r.line} = ${fmt(r.result)}`); setAcc(r.result); show(r.result);
    } else setAcc(v);
    setOp(o); setFresh(true);
    setNote(o === 'disc' ? 'Enter the discount %, then =' : o === 'markup' ? 'Enter the markup %, then =' : o === 'margin' ? 'Enter the cost, then =' : '');
  }
  function equals() {
    if (op == null || acc == null) return;
    const r = apply(acc, op, value());
    log(`${r.line} = ${fmt(r.result)}${op === 'margin' ? '%' : ''}`);
    setAcc(null); setOp(null); show(r.result); setNote(op === 'margin' ? 'Margin, % of the price' : '');
  }
  function unary(kind: 'vat+' | 'vat-' | 'pct' | 'neg') {
    const v = value();
    if (kind === 'neg') { setDisplay(String(-v)); return; }
    if (kind === 'pct') { const r = acc != null ? (acc * v) / 100 : v / 100; setDisplay(String(fix(r))); setFresh(true); return; }
    const r = kind === 'vat+' ? v * (1 + VAT) : v / (1 + VAT);
    log(`${fmt(v)} ${kind === 'vat+' ? '+ VAT 12%' : 'less VAT 12% (VAT ' + fmt(v - r) + ')'} = ${fmt(r)}`);
    show(r); setNote(kind === 'vat+' ? `VAT ${fmt(r - v)}` : `VAT ${fmt(v - r)} removed`);
  }
  function clear() { setDisplay('0'); setAcc(null); setOp(null); setFresh(true); setNote(''); }
  function back() { if (fresh) return; setDisplay(display.length > 1 ? display.slice(0, -1) : '0'); }
  function use() {
    const v = Math.round(value() * 100) / 100;
    if (!Number.isFinite(v)) return;
    const f = lastField;
    if (!f || !document.contains(f)) { setNote('Click the field to fill first, then press Use.'); return; }
    const proto = f instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(f, String(v));
    f.dispatchEvent(new Event('input', { bubbles: true }));
    f.dispatchEvent(new Event('change', { bubbles: true }));
    f.focus();
    setNote(`Put ${fmt(v)} in the field`);
  }

  function onKey(e: React.KeyboardEvent) {
    const k = e.key;
    if (/^[0-9]$/.test(k) || k === '.') { digit(k); e.preventDefault(); }
    else if (k === '+') operator('+'); else if (k === '-') operator('-');
    else if (k === '*' || k === 'x') operator('×'); else if (k === '/') { operator('÷'); e.preventDefault(); }
    else if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); }
    else if (k === 'Backspace') back(); else if (k === 'Escape') { if (display !== '0' || op) clear(); else onClose(); }
    else if (k === '%') unary('pct');
  }

  const startDrag = (e: React.PointerEvent) => {
    if (isPhone || !pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos({ x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - 120), y: Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - 60) });
  };

  const key = (label: string, fn: () => void, tone = 'bg-slate-100 hover:bg-slate-200', title?: string) => (
    <button type="button" title={title} onClick={() => { fn(); panel.current?.focus(); }} className={`rounded-lg py-2.5 text-sm font-semibold ${tone}`}>{label}</button>
  );
  const style: React.CSSProperties = isPhone ? { left: 0, right: 0, bottom: 0 } : { left: pos?.x ?? 16, top: pos?.y ?? 80, width: 330 };

  return (
    <div data-ibx-calculator ref={panel} tabIndex={-1} onKeyDown={onKey} style={style}
      className={`fixed z-[60] select-none border bg-white text-slate-900 shadow-2xl outline-none ${isPhone ? 'rounded-t-2xl pb-[env(safe-area-inset-bottom)]' : 'rounded-xl'}`}>
      <div onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={() => { drag.current = null; }}
        className={`flex items-center justify-between rounded-t-xl bg-slate-800 px-3 py-2 text-white ${isPhone ? '' : 'cursor-move'}`}>
        <span className="text-sm font-semibold">🧮 Calculator</span>
        <button type="button" onClick={onClose} className="px-2 text-lg leading-none" aria-label="Close calculator">×</button>
      </div>
      <div className="space-y-2 p-3">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-right">
          <div className="h-4 text-xs text-slate-500">{acc != null && op ? `${fmt(acc)} ${OP_LABEL[op]}` : note}</div>
          <div className="truncate text-3xl font-bold tabular-nums">{display === '' ? '0' : fresh ? fmt(value()) : display}</div>
          {acc != null && op && note && <div className="text-[11px] text-sky-700">{note}</div>}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {key('+VAT', () => unary('vat+'), 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100', 'Add 12% VAT')}
          {key('−VAT', () => unary('vat-'), 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100', 'Remove 12% VAT from a VAT-inclusive amount')}
          {key('Disc %', () => operator('disc'), 'bg-amber-50 text-amber-800 hover:bg-amber-100', 'Amount less a discount %: amount, Disc %, percent, =')}
          {key('Markup', () => operator('markup'), 'bg-amber-50 text-amber-800 hover:bg-amber-100', 'Price from cost: cost, Markup, percent, =')}
          {key('C', clear, 'bg-red-50 text-red-700 hover:bg-red-100')}
          {key('⌫', back)}
          {key('Margin', () => operator('margin'), 'bg-amber-50 text-amber-800 hover:bg-amber-100', 'Margin %: price, Margin, cost, =')}
          {key('÷', () => operator('÷'), 'bg-slate-200 hover:bg-slate-300')}
          {['7', '8', '9'].map((d) => <span key={d} className="contents">{key(d, () => digit(d), 'bg-white border hover:bg-slate-50')}</span>)}
          {key('×', () => operator('×'), 'bg-slate-200 hover:bg-slate-300')}
          {['4', '5', '6'].map((d) => <span key={d} className="contents">{key(d, () => digit(d), 'bg-white border hover:bg-slate-50')}</span>)}
          {key('−', () => operator('-'), 'bg-slate-200 hover:bg-slate-300')}
          {['1', '2', '3'].map((d) => <span key={d} className="contents">{key(d, () => digit(d), 'bg-white border hover:bg-slate-50')}</span>)}
          {key('+', () => operator('+'), 'bg-slate-200 hover:bg-slate-300')}
          {key('±', () => unary('neg'), 'bg-white border hover:bg-slate-50')}
          {key('0', () => digit('0'), 'bg-white border hover:bg-slate-50')}
          {key('.', () => digit('.'), 'bg-white border hover:bg-slate-50')}
          {key('=', equals, 'bg-slate-800 text-white hover:bg-slate-700')}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={use} className="flex-1 rounded-lg bg-sky-700 py-2 text-sm font-semibold text-white hover:bg-sky-800" title="Put the result into the field you last selected">Use</button>
          <button type="button" onClick={() => { void navigator.clipboard?.writeText(String(Math.round(value() * 100) / 100)).then(() => setNote('Copied')).catch(() => undefined); }} className="rounded-lg border px-3 py-2 text-sm">Copy</button>
        </div>
        {tape.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded border bg-slate-50 p-2 text-xs text-slate-600">
            <div className="mb-1 flex justify-between"><span className="font-semibold">Tape</span><button type="button" className="text-slate-500 hover:underline" onClick={() => { setTape([]); saveTape([]); }}>Clear</button></div>
            {tape.map((t, i) => <button type="button" key={i} className="block w-full truncate text-left tabular-nums hover:text-slate-900" title="Use this result" onClick={() => { const m = t.split('=').pop()?.replace(/[^0-9.\-]/g, ''); if (m) { setDisplay(m); setFresh(true); } }}>{t}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}
