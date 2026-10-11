// Build 102c / 104a — launch screen styles, placed in <head> (app/layout.tsx) so the colours are there before
// anything else is drawn. Laid out like the phone's own start screen (logo in the middle, the name near the bottom
// in Roboto Condensed) so the hand-over only changes the background from blue to the blue → red gradient.
// The name shimmers (a light sweeps across it, gold, then red, then blue) and a soft glow of the same colour shows
// around the logo's edges, looping until the app has loaded.
export const LAUNCH_CSS = `@font-face{font-family:'IBX Launch';src:url(/fonts/roboto-condensed-400.woff2) format('woff2');font-weight:400;font-display:block}
html.ibx-launching,html.ibx-launching body{background:#0a37a6}
.ibx-launch{display:none}
html.ibx-launching .ibx-launch{display:flex;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#0a37a6 0%,#0a37a6 50%,#3d3f9a 60%,#7d4479 75%,#c21d36 100%);transition:opacity .4s ease}
html.ibx-launch-out .ibx-launch{opacity:0;pointer-events:none}
.ibx-launch .ibx-launch-logo{position:relative;width:84px;height:84px}
.ibx-launch .ibx-launch-logo img{position:relative;z-index:1;display:block;width:84px;height:84px;border-radius:19px}
.ibx-launch .ibx-launch-logo::before{content:"";position:absolute;inset:-17px;border-radius:36px;filter:blur(19px);opacity:.85;z-index:0;animation:ibx-glow 4.2s linear infinite}
.ibx-launch .ibx-launch-logo::after{content:"";position:absolute;inset:-4px;border-radius:23px;filter:blur(4px);opacity:.9;z-index:0;animation:ibx-rim 4.2s linear infinite}
@keyframes ibx-glow{0%,22%{background:#ffd84d;transform:scale(1)}11%{transform:scale(1.08)}33%,55%{background:#ff6f7d;transform:scale(1)}44%{transform:scale(1.08)}66%,88%{background:#7fb0ff;transform:scale(1)}77%{transform:scale(1.08)}100%{background:#ffd84d;transform:scale(1)}}
@keyframes ibx-rim{0%,22%{background:#ffe58a}33%,55%{background:#ff9aa4}66%,88%{background:#aecbff}100%{background:#ffe58a}}
.ibx-launch .ibx-launch-name{position:absolute;left:0;right:0;bottom:calc(96px + env(safe-area-inset-bottom));text-align:center;
  font:400 23px 'IBX Launch','Roboto Condensed',Roboto,sans-serif;letter-spacing:.2px;color:#fff}
.ibx-launch .ibx-launch-name span{color:transparent;-webkit-background-clip:text;background-clip:text;background-repeat:repeat-x;background-size:300% 100%;
  background-image:linear-gradient(100deg,#fff 0%,#fff 6%,#7fb0ff 11%,#fff 16%,#fff 39%,#ff6f7d 44%,#fff 49%,#fff 72%,#ffd84d 77%,#fff 82%,#fff 100%);
  animation:ibx-shimmer 4.2s linear infinite}
@keyframes ibx-shimmer{from{background-position:150% 0}to{background-position:0% 0}}
@media (prefers-reduced-motion:reduce){.ibx-launch .ibx-launch-name span{animation:none;color:#fff}.ibx-launch .ibx-launch-logo::before,.ibx-launch .ibx-launch-logo::after{animation:none;background:#ffd84d}}`;
