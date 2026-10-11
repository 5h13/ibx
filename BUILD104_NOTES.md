# Build 104: sign in with a username, users without email, nicknames

## Deploy
1. Unzip into desktop\ipa (paths kept).
2. Run `supabase db push`. This applies one migration, 20270110_usernames.sql. Run it **before** pushing the code.
3. Run `git add -A`, then commit and push. Wait for Vercel to show "Ready".

Files to delete: none.

## What changes
- **Login:** one field, "Username or email". A wrong username or password shows the same message, so nobody can test which usernames exist.
- **Usernames:** the first letter of the first name plus the surname, written without spaces.
  - Alfredo Santiago → A.Santiago. Maria Dela Cruz → M.DelaCruz. Accents are dropped (Peña → Pena).
  - A username that's already taken gets a number: A.Santiago2.
  - Upper and lower case don't matter when signing in.
- **Existing accounts** get a username now, made from their name (e.g. the Super Admin → S.Admin). Signing in with an email still works.
- **Shiena:** Shiena Chavez, Shiena Lyn Chavez or Lyn Chavez → username **5H13**. After she signs in she sees "Good morning / afternoon / evening 5H13!" (Manila time), once per sign-in.
- **My Profile** (click your name in the header, or the agent app menu) has a new "Sign-in and name" section:
  - Change your username.
  - Set a nickname, shown on screens instead of your full name. Documents keep the full name.
  - Add or change your email. Once added, you can also sign in with it, and password-reset emails work.
- **Settings → Users → Add user:**
  - First name and Surname are entered separately.
  - The suggested username is shown, and you can type a different one.
  - Email is optional. Without an email, the user gets a temporary password (the invitation option needs an email).
  - The new username is shown after saving.
  - Edit user: change the names, the username, or add an email.
- **The user list** shows each username, nickname, and "no email" where there is none.
- **Users without an email:** "Send password link" explains that they need a temporary password ("Reset password") or an email first.

## How "no email" works
The sign-in system needs an email behind every account. A user saved without one gets a hidden address on the reserved domain `nomail.5h13.invalid`. It can never receive mail and is never shown.

**Please test this once:** add one user without an email and sign in as them.
- If Supabase refuses the hidden address when you save the user, tell me. The fix is a one-line setting (NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN in Vercel), no rebuild.

## Tested
- proof104: 18 checks.
- Full replay of proofs 78–104: 0 failures.
- tsc and next build pass.
- I opened the new login page and checked the wrong-password message.
