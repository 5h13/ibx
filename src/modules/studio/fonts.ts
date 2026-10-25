// Build 11 (Studio): the fonts the Studio draws with. Self-hosted in /public/fonts (SIL Open Font License), loaded
// with the FontFace API so the canvas can use them. Body text is Plus Jakarta Sans (the app's font); the headline
// font is the seller's choice (D44, default Barlow Condensed). Fonts without a peso sign fall back to Jakarta's.
export const STUDIO_FONTS = [
  { key: 'barlow', label: 'Barlow Condensed', note: 'narrow, technical', file: 'barlow-condensed-latin-800-normal', ext: null, weight: 800 },
  { key: 'oswald', label: 'Oswald', note: 'tall, signage look', file: 'oswald-latin-700-normal', ext: 'oswald-latin-ext-700-normal', weight: 700 },
  { key: 'saira', label: 'Saira Condensed', note: 'squared, engineering', file: 'saira-condensed-latin-800-normal', ext: null, weight: 800 },
  { key: 'archivo', label: 'Archivo', note: 'wide and sturdy', file: 'archivo-latin-800-normal', ext: 'archivo-latin-ext-800-normal', weight: 800 },
  { key: 'roboto', label: 'Roboto Condensed', note: 'plain, neutral', file: 'roboto-condensed-latin-800-normal', ext: 'roboto-condensed-latin-ext-800-normal', weight: 800 },
] as const;
export type StudioFont = (typeof STUDIO_FONTS)[number]['key'];
export const DEFAULT_FONT: StudioFont = 'barlow';

const LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

/** Family names used in the canvas (kept apart from the page's own fonts). */
export const BODY = '"StudioJakarta"';
export const headFamily = (f: StudioFont) => `"StudioHead-${f}", "StudioJakarta"`;

let loading: Promise<void> | null = null;
/** Loads every Studio font once (about 250 KB). Safe to call many times. */
export function loadStudioFonts(): Promise<void> {
  if (loading) return loading;
  const faces: FontFace[] = [];
  for (const w of [400, 600, 700, 800]) {
    faces.push(new FontFace('StudioJakarta', `url(/fonts/plus-jakarta-sans-latin-${w}-normal.woff2)`, { weight: String(w), unicodeRange: LATIN }));
    faces.push(new FontFace('StudioJakarta', `url(/fonts/plus-jakarta-sans-latin-ext-${w}-normal.woff2)`, { weight: String(w), unicodeRange: LATIN_EXT }));
  }
  for (const f of STUDIO_FONTS) {
    // registered for every weight the templates ask for, so a "800" request on Oswald (700) still finds it
    for (const w of ['400 900']) {
      faces.push(new FontFace(`StudioHead-${f.key}`, `url(/fonts/${f.file}.woff2)`, { weight: w, unicodeRange: LATIN }));
      if (f.ext) faces.push(new FontFace(`StudioHead-${f.key}`, `url(/fonts/${f.ext}.woff2)`, { weight: w, unicodeRange: LATIN_EXT }));
    }
  }
  loading = Promise.all(faces.map(async (face) => { try { document.fonts.add(await face.load()); } catch { /* a missing font falls back */ } })).then(() => undefined);
  return loading;
}
