// Build 122 — turns the owner's marketing tools (tools/marketing/src/*.html, kept exactly as he made them) into
// the copies the app serves from public/marketing-tools/. Run after dropping in a new version of a tool:
//
//     node tools/marketing/build.mjs
//
// What it changes (nothing else):
//   * outside libraries (Tailwind, html2canvas, gif.js, React, Babel, Google Fonts) → the app's own copies in
//     public/marketing-tools/lib, production builds — no internet needed to open or export;
//   * Specs Card: its Tailwind classes compiled once into lib/specs-card.css (instead of the Tailwind CDN);
//   * Banner Studio: its JSX compiled once into banner-studio.app.js (instead of Babel in the browser on every
//     open); the store logos pasted in the file are written out as image files and used only as a fallback;
//   * ibx-bridge.js added: the store logos come from the app's store settings (Admin → Businesses → Branding).
// Needs: npx (downloads esbuild and tailwindcss 3 on first run).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = join(ROOT, 'tools/marketing/src');
const OUT = join(ROOT, 'public/marketing-tools');
const TMP = join(ROOT, 'tools/marketing/.tmp');
mkdirSync(join(OUT, 'lib'), { recursive: true }); mkdirSync(join(OUT, 'img'), { recursive: true }); mkdirSync(TMP, { recursive: true });

function mustReplace(s, from, to, what) {
  if (typeof from === 'string' ? !s.includes(from) : !from.test(s)) throw new Error(`build: could not find ${what} — the tool changed; update tools/marketing/build.mjs`);
  return s.replace(from, to);
}

// ------------------------------------------------------------------------------------------------ Specs Card --
{
  let h = readFileSync(join(SRC, 'specs-card.html'), 'utf8');
  h = mustReplace(h, /<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, '<link rel="stylesheet" href="lib/specs-card.css" />', 'Tailwind CDN');
  h = mustReplace(h, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/html2canvas\/[^"]+"><\/script>/, '<script src="lib/html2canvas.min.js"></script>', 'html2canvas');
  h = mustReplace(h, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/gif\.js@[^"]+\/dist\/gif\.js"><\/script>/, '<script src="lib/gif.js"></script>', 'gif.js');
  h = mustReplace(h, /fetch\('https:\/\/cdn\.jsdelivr\.net\/npm\/gif\.js@[^']+\/dist\/gif\.worker\.js'\)/, "fetch(new URL('lib/gif.worker.js', document.baseURI).href)", 'GIF worker');
  h = mustReplace(h, "new URL('5H13 Logo.jpg', document.baseURI).href", "new URL('/brand/5h13-logo.jpg', document.baseURI).href", 'default logo');
  h = mustReplace(h, /<\/body>/, '  <script src="ibx-bridge.js" data-tool="specs-card"></script>\n</body>', '</body>');
  writeFileSync(join(OUT, 'specs-card.html'), h);
  // Tailwind: compile the classes the page uses (including the ones its script switches between)
  writeFileSync(join(TMP, 'in.css'), '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  writeFileSync(join(TMP, 'tailwind.config.cjs'), `module.exports = { content: [${JSON.stringify(join(SRC, 'specs-card.html'))}], theme: { extend: {} }, plugins: [] };`);
  execSync(`npx -y tailwindcss@3.4.17 -c ${JSON.stringify(join(TMP, 'tailwind.config.cjs'))} -i ${JSON.stringify(join(TMP, 'in.css'))} -o ${JSON.stringify(join(OUT, 'lib/specs-card.css'))} --minify`, { stdio: 'inherit' });
}

// --------------------------------------------------------------------------------------------- Banner Studio --
{
  let h = readFileSync(join(SRC, 'banner-studio.html'), 'utf8');
  // the store logos pasted in the file → image files (fallback when a store has no logo in the app)
  const block = h.match(/const STORE_LOGOS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error('build: STORE_LOGOS not found');
  const fallback = {};
  for (const m of block[1].matchAll(/^\s*([A-Z0-9_]+):\s*"data:image\/(png|jpeg|webp);base64,([^"]+)"/gm)) {
    const file = `img/logo-${m[1]}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`;
    writeFileSync(join(OUT, file), Buffer.from(m[3], 'base64'));
    fallback[m[1]] = file;
  }
  h = h.replace(block[0], `// Build 122: logos from the app's store settings (ibx-bridge.js); the original pasted logos are the fallback\nconst STORE_LOGOS = Object.assign(${JSON.stringify(fallback)}, window.__IBX_LOGOS || {});`);
  h = h.replaceAll('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js', "${new URL('lib/gif.worker.js', document.baseURI).href}");
  // Build 123: the store is the one the user is acting as in the app (ibx-bridge.js sets window.__IBX_STORE);
  // the studio's own store switching (rail card, Brand Settings switch / add / delete brand, phone "Store:" button,
  // remembered store) is removed while a store is set. A store the studio does not know keeps the old behaviour.
  h = mustReplace(h, 'const [selectedStoreKey, setSelectedStoreKey] = useState("PILI");',
    'const IBX_LOCK = (window.__IBX_STORE && STORE_CONFIGS[window.__IBX_STORE]) ? window.__IBX_STORE : null;\n  const [selectedStoreKey, setSelectedStoreKey] = useState(IBX_LOCK || "PILI");', 'store state');
  h = mustReplace(h, 'if (parsed.selectedStoreKey && storeConfigs[parsed.selectedStoreKey]) setSelectedStoreKey(parsed.selectedStoreKey);',
    'if (!IBX_LOCK && parsed.selectedStoreKey && storeConfigs[parsed.selectedStoreKey]) setSelectedStoreKey(parsed.selectedStoreKey);', 'remembered store');
  h = mustReplace(h, 'const cycleStore = () => {', 'const cycleStore = () => { if (IBX_LOCK) return;', 'store switch');
  const hide = (re, what) => { h = mustReplace(h, re, (m) => `{!IBX_LOCK && (<React.Fragment>${m}</React.Fragment>)}`, what); };
  hide(/<div className="rail-divider" \/>\s*<div className="rail-section-title">STORE<\/div>\s*<button className="store-card"[\s\S]*?<\/button>/, 'rail store card');
  hide(/<div style=\{\{display:'flex',gap:'8px',marginBottom:'10px'\}\}>\s*<button className="btn btn-primary" type="button" onClick=\{\(\) => setBrandManagerMode\("new"\)\}>[\s\S]*?<\/div>\s*<button className="store-card panel-store-card"[\s\S]*?<\/button>/, 'Brand Settings store switch');
  hide(/<button type="button" onClick=\{cycleStore\}>\s*Store: \{currentStore\.name\}\s*<\/button>/, 'phone store button');
  // Build 124: "From catalog" (ibx-bridge.js) fills the product texts through this hook; each stays editable
  h = mustReplace(h, /(  const \[announcementClosingMessage, setAnnouncementClosingMessage\] = useState\([^\n]*\);\n)/, `$1  useEffect(() => {
    window.__ibxFill = (d) => {
      if (d.rightLine1 != null) setRightLine1Text(d.rightLine1);
      if (d.rightLine2 != null) setRightLine2Text(d.rightLine2);
      if (d.rightLine3 != null) setRightLine3Text(d.rightLine3);
      if (d.info1Category != null) setInfo1CategoryText(d.info1Category);
      if (d.info1Feature != null) setInfo1FeatureText(d.info1Feature);
      if (d.info2Feature != null) setInfo2FeatureText(d.info2Feature);
    };
    return () => { delete window.__ibxFill; };
  }, []);
`, 'text fill hook');
  // compile the JSX once
  const app = h.match(/<script type="text\/babel">([\s\S]*?)<\/script>/);
  if (!app) throw new Error('build: the text/babel script was not found');
  writeFileSync(join(TMP, 'banner.jsx'), app[1]);
  execSync(`npx -y esbuild@0.23.0 ${JSON.stringify(join(TMP, 'banner.jsx'))} --loader:.jsx=jsx --jsx=transform --jsx-factory=React.createElement --jsx-fragment=React.Fragment --tsconfig-raw={} --target=es2019 --minify --outfile=${JSON.stringify(join(OUT, 'banner-studio.app.js'))}`, { stdio: 'inherit' });
  h = h.replace(app[0], '<script src="ibx-bridge.js" data-tool="banner-studio" data-app="banner-studio.app.js"></script>');
  h = mustReplace(h, /<script src="https:\/\/unpkg\.com\/react@18\/umd\/react\.development\.js"><\/script>/, '<script src="lib/react.production.min.js"></script>', 'React');
  h = mustReplace(h, /<script src="https:\/\/unpkg\.com\/react-dom@18\/umd\/react-dom\.development\.js"><\/script>/, '<script src="lib/react-dom.production.min.js"></script>', 'ReactDOM');
  h = mustReplace(h, /\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone\/babel\.min\.js"><\/script>/, '', 'Babel');
  h = mustReplace(h, /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/gif\.js\/0\.2\.0\/gif\.js"><\/script>/, '<script src="lib/gif.js"></script>', 'gif.js');
  h = mustReplace(h, /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter[^"]*">/, '<link rel="stylesheet" href="lib/inter.css">', 'Inter font');
  // Build 123: a compact layout on top of the studio's own styles (smaller header, layout tiles and menu) so the
  // preview fits the screen inside the app
  h = mustReplace(h, /<\/head>/, '<link rel="stylesheet" href="lib/banner-ibx.css">\n</head>', '</head>');
  h = h.replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g, '');
  writeFileSync(join(OUT, 'banner-studio.html'), h);
}
console.log('marketing tools built → public/marketing-tools');
