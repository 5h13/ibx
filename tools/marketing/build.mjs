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
  h = h.replace(/\s*<link rel="preconnect" href="https:\/\/fonts\.(googleapis|gstatic)\.com"[^>]*>/g, '');
  writeFileSync(join(OUT, 'banner-studio.html'), h);
}
console.log('marketing tools built → public/marketing-tools');
