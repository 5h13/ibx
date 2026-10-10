// Build 102c — launch screen styles, placed in <head> (app/layout.tsx)
// so the colours are there before anything else is drawn
export const LAUNCH_CSS = `html.ibx-launching,html.ibx-launching body{background:#0a37a6}
.ibx-launch{display:none}
html.ibx-launching .ibx-launch{display:flex;position:fixed;inset:0;z-index:9999;align-items:center;justify-content:center;
  background:linear-gradient(180deg,#0a37a6 0%,#0a37a6 50%,#3d3f9a 60%,#7d4479 75%,#c21d36 100%);transition:opacity .4s ease}
html.ibx-launch-out .ibx-launch{opacity:0;pointer-events:none}
.ibx-launch .ibx-launch-name{position:absolute;left:0;right:0;bottom:calc(48px + env(safe-area-inset-bottom));text-align:center;color:#fff;font-size:17px;font-weight:500;letter-spacing:.2px}
.ibx-launch img{width:120px;height:120px;border-radius:26px;box-shadow:0 10px 30px rgba(0,0,0,.25)}`;
