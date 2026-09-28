-- ============================================================================
-- Build 72 — user onboarding (punchlist U065, user 2026-09-28):
--   • New users can be invited by email (Supabase invitation through the
--     project's Gmail SMTP): they open the link and set their own password.
--   • When an admin sets or resets a password instead, the account must
--     change it at the next sign-in: users.must_change_password = true until
--     the user chooses a new password (the app sends them straight to the
--     Change password screen).
-- ============================================================================
alter table public.users add column if not exists must_change_password boolean not null default false;
comment on column public.users.must_change_password is 'True after an admin sets / resets the password; cleared when the user sets their own (Build 72).';
