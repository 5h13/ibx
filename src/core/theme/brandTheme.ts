// Build 63 — store (business) themes.
//
// The whole UI is drawn with a small set of Tailwind colour classes (white,
// slate-*, blue-*). tailwind.config.js maps each of them to a CSS variable
// (see VAR_DEFAULTS, which reproduce the original look exactly), so a store
// theme re-colours every page — header, sidebar, panels, forms, buttons,
// links, dialogs — by setting those variables once in AuthedShell.
//
// A theme is 8 colours + light/dark mode, stored in businesses.branding.theme.
// All other shades (muted text, hover, subtle panels, borders…) are derived.

export type BrandTheme = {
  preset?: string;
  mode: 'light' | 'dark';
  header: string;      // header / sidebar colour
  headerEnd: string;   // header gradient end
  headerText: string;  // text on header / sidebar
  page: string;        // page background
  panel: string;       // cards, tables, forms
  text: string;        // main text
  accent: string;      // buttons, links, highlights
  border: string;      // lines around panels and fields
};

export const THEME_FIELDS: { key: Exclude<keyof BrandTheme, 'preset' | 'mode'>; label: string }[] = [
  { key: 'header', label: 'Header & sidebar' },
  { key: 'headerEnd', label: 'Header gradient end' },
  { key: 'headerText', label: 'Header & sidebar text' },
  { key: 'page', label: 'Page background' },
  { key: 'panel', label: 'Panels & forms' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent (buttons, links)' },
  { key: 'border', label: 'Borders' },
];

export const THEME_PRESETS: Record<string, { label: string; theme: BrandTheme }> = {
  sky: {
    label: 'Sky (light blue)',
    theme: { preset: 'sky', mode: 'light', header: '#d6effb', headerEnd: '#bfe5f8', headerText: '#0b3a5b', page: '#eaf6fd', panel: '#f8fcff', text: '#0b3a5b', accent: '#0284c7', border: '#bfe3f5' },
  },
  maroon: {
    label: 'Maroon (dark)',
    theme: { preset: 'maroon', mode: 'dark', header: '#2e1416', headerEnd: '#5b3133', headerText: '#f6e7e2', page: '#2a1315', panel: '#3a1f21', text: '#f3e3de', accent: '#e3a1a6', border: '#6b3d3f' },
  },
  forest: {
    label: 'Forest (light green)',
    theme: { preset: 'forest', mode: 'light', header: '#dcf2e3', headerEnd: '#c3e8cf', headerText: '#123d25', page: '#eef8f1', panel: '#fbfefc', text: '#143a26', accent: '#16a34a', border: '#c4e4cf' },
  },
  slate: {
    label: 'Slate (dark)',
    theme: { preset: 'slate', mode: 'dark', header: '#0b1220', headerEnd: '#1e293b', headerText: '#e2e8f0', page: '#0f172a', panel: '#1e293b', text: '#e2e8f0', accent: '#38bdf8', border: '#334155' },
  },
};

// Original app colours (Tailwind slate/blue), as "R G B" channels.
export const VAR_DEFAULTS: Record<string, string> = {
  'bg-surface': '255 255 255', 'bg-subtle': '248 250 252', 'bg-subtle2': '241 245 249', 'bg-subtle3': '226 232 240',
  'bg-strong': '15 23 42', 'bg-strong2': '30 41 59', 'bg-strong3': '51 65 85', 'bg-accent-soft': '239 246 255',
  'tx-on-strong': '255 255 255', 'tx-on-strong-muted': '203 213 225', 'tx-on-strong-muted2': '226 232 240',
  'tx-muted2': '148 163 184', 'tx-muted': '100 116 139', 'tx-text2': '71 85 105', 'tx-text2b': '51 65 85',
  'tx-text': '30 41 59', 'tx-strong': '15 23 42', 'tx-accent': '37 99 235', 'tx-accent2': '29 78 216',
  'bd': '226 232 240', 'bd-input': '203 213 225', 'bd-strong': '148 163 184', 'bd-strong-dark': '71 85 105',
  'btn': '15 23 42', 'on-btn': '255 255 255', 'link': '37 99 235',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
type RGB = [number, number, number];
const rgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)) as RGB;
const ch = (c: RGB) => c.join(' ');
const lum = ([r, g, b]: RGB) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** Readable text colour on a background: white when it contrasts well enough, otherwise the given dark colour. */
const onColor = (c: RGB, dark: RGB = [15, 23, 42]): RGB => (contrast(c, [255, 255, 255]) >= 3.5 ? [255, 255, 255] : dark);
/** Text colour for a button in the accent colour (used by the branding preview too). */
export function onAccentHex(theme: BrandTheme): string {
  const dark = theme.mode === 'dark' ? rgb(theme.page) : rgb(theme.text);
  const c = onColor(rgb(theme.accent), lum(dark) < 0.2 ? dark : [15, 23, 42]);
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Validate a theme from the database / a form; null if unusable. */
export function parseTheme(raw: unknown): BrandTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const out: any = { preset: typeof t.preset === 'string' ? t.preset : undefined, mode: t.mode === 'dark' ? 'dark' : 'light' };
  for (const f of THEME_FIELDS) {
    const v = t[f.key];
    if (typeof v !== 'string' || !HEX.test(v)) return null;
    out[f.key] = v.toLowerCase();
  }
  return out as BrandTheme;
}

/** All CSS variables for a theme ("R G B" channels). */
export function themeVars(theme: BrandTheme): Record<string, string> {
  const H = rgb(theme.header), HT = rgb(theme.headerText), P = rgb(theme.page), S = rgb(theme.panel), T = rgb(theme.text), A = rgb(theme.accent), B = rgb(theme.border);
  const dark = theme.mode === 'dark';
  return {
    'bg-surface': ch(S), 'bg-subtle': ch(P), 'bg-subtle2': ch(mix(S, T, dark ? 0.08 : 0.05)), 'bg-subtle3': ch(mix(S, T, dark ? 0.14 : 0.1)),
    'bg-strong': ch(H), 'bg-strong2': ch(mix(H, P, dark ? 0.35 : 0.5)), 'bg-strong3': ch(mix(H, HT, 0.14)), 'bg-accent-soft': ch(mix(S, A, dark ? 0.18 : 0.1)),
    'tx-on-strong': ch(HT), 'tx-on-strong-muted': ch(mix(HT, H, 0.28)), 'tx-on-strong-muted2': ch(mix(HT, H, 0.15)),
    'tx-muted2': ch(mix(T, S, 0.5)), 'tx-muted': ch(mix(T, S, 0.38)), 'tx-text2': ch(mix(T, S, 0.22)), 'tx-text2b': ch(mix(T, S, 0.12)),
    'tx-text': ch(T), 'tx-strong': ch(T), 'tx-accent': ch(A), 'tx-accent2': ch(mix(A, T, 0.2)),
    'bd': ch(B), 'bd-input': ch(mix(B, T, 0.15)), 'bd-strong': ch(mix(B, T, 0.35)), 'bd-strong-dark': ch(mix(H, HT, 0.3)),
    'btn': ch(A), 'on-btn': ch(rgb(onAccentHex(theme))), 'link': ch(A),
  };
}

/** The <style> body AuthedShell renders for a branded business (empty = default look). */
export function themeCss(theme: BrandTheme | null): string {
  if (!theme) return '';
  const vars = themeVars(theme);
  return `:root{color-scheme:${theme.mode};${Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(';')}}`;
}

export const headerBackground = (t: BrandTheme | null) => (t ? `linear-gradient(90deg, ${t.header}, ${t.headerEnd})` : undefined);
