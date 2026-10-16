# Build 121 — user admin fixes (no migration)

Deploy: `git add -A`, commit, push.

- **Password-reset link failed in the user's browser** ("PKCE code verifier not found in storage"). The reset
  email was requested through the admin's own session, so the one-time secret the link needed was stored in the
  admin's browser. It is now requested without any session; the emailed link carries its own one-time sign-in,
  which "Set your password" (/auth/accept) already opens — the same way invitations work.
  Links sent before this build still fail: send a new one.
- **Temporary password typing stopped after one character** (Add user). The typed password was kept on the outer
  User Management screen, so each keystroke rebuilt the Add user form (focus lost, and role / sections / store /
  invite choice reset). It now lives in the form; the outer screen keeps only the password returned after saving.
- **Installed app and links**: the app now asks the browser to open its links (e.g. a reset email) in the installed
  app ("Open supported links" in Chrome / Edge app settings; phones usually do it already). Otherwise the link
  opens in a tab, which shares the same sign-in.

Files: src/modules/admin/users/actions.ts, src/modules/admin/users/UserManagement.tsx, app/manifest.ts

Check after deploy
1. Users → Add user → "Set a temporary password": type a full password without clicking back in.
2. Send a password link to a user who has signed in before; open it in another browser / device → "Set your password".
