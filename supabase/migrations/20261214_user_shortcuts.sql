-- ============================================================================
-- Build 82 — 5H13 Shortcuts (owner, 2026-10-03): each user pins the pages and
-- actions they use most at the top of the sidebar. One row per user with the
-- ordered list of shortcut keys; a user reads and writes only their own row.
-- What a user may pin is decided by the app from their access (the pages
-- themselves still check access when opened).
-- ============================================================================
create table if not exists public.user_shortcuts (
  user_id uuid primary key references public.users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 40),
  updated_at timestamptz not null default now()
);
alter table public.user_shortcuts enable row level security;
drop policy if exists user_shortcuts_own on public.user_shortcuts;
create policy user_shortcuts_own on public.user_shortcuts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.user_shortcuts to authenticated;
