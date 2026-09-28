/** @type {import('tailwindcss').Config} */
// Build 63 — store themes. The UI's neutral/accent colour classes resolve to
// CSS variables (defaults in app/globals.css = the original slate/blue look;
// a business theme overrides them — src/core/theme/brandTheme.ts). Status
// colours (red, amber, emerald, green) are unchanged.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      backgroundColor: {
        white: v('bg-surface'),
        slate: { 50: v('bg-subtle'), 100: v('bg-subtle2'), 200: v('bg-subtle3'), 700: v('bg-strong3'), 800: v('bg-strong2'), 900: v('bg-strong') },
        blue: { 50: v('bg-accent-soft') },
        indigo: { 100: v('bg-accent-soft') },
      },
      textColor: {
        white: v('tx-on-strong'),
        slate: { 200: v('tx-on-strong-muted2'), 300: v('tx-on-strong-muted'), 400: v('tx-muted2'), 500: v('tx-muted'), 600: v('tx-text2'), 700: v('tx-text2b'), 800: v('tx-text'), 900: v('tx-strong') },
        blue: { 600: v('tx-accent'), 700: v('tx-accent2') },
        indigo: { 700: v('tx-accent2') },
      },
      borderColor: {
        DEFAULT: v('bd'),
        slate: { 100: v('bd'), 200: v('bd'), 300: v('bd-input'), 400: v('bd-strong'), 500: v('bd-strong'), 600: v('bd-strong-dark'), 800: v('bd-strong-dark'), 900: v('bd-strong-dark') },
      },
      divideColor: { DEFAULT: v('bd') },
      ringColor: { slate: { 500: v('tx-accent') } },
    },
  },
  plugins: [],
};
