# Build 117 — Install the office app on a computer (and any phone)

**Deploy:** no migration. Commit, push, wait for Vercel "Ready". (Build 116's `supabase db push` first if not done yet.)

## What changes
- **Every page can be installed**, not only the agent app: the browser's install helper (service worker) now starts on all pages.
- **"⤓ Install app" button** in the header (computer) and in the phone account menu, shown only when the browser allows installing and the app is not installed yet. On an iPhone it shows the Safari → Share → Add to Home Screen steps.
- **The installed app opens on the home page**, which sends office users to the Dashboard and agents to the agent app. It works in a computer window and on a tablet in landscape (no longer locked to portrait).
- Phones that already installed the agent app keep the same app (same app id); they now open through the home page, which still takes agents to the agent app.

## How to install on a computer (Chrome or Edge)
1. Open the app and sign in.
2. Click **⤓ Install app** in the header — or the install icon at the right end of the address bar — or **⋮ → Cast, save and share → Install page as app** (Chrome) / **⋯ → Apps → Install this site as an app** (Edge).
3. 5H13 opens in its own window, with an icon on the desktop / Start menu / taskbar.

The installed app is the same live app: no data is stored on the computer, and every update on Vercel shows at once.

## Checks
- typecheck and production build pass. No database change.
