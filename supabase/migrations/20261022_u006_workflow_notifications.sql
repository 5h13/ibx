-- U006: Workflow Notifications
--
-- Shared, generic notification mechanism so any module's workflow can notify
-- the next role holder (and notify an originator on return/rejection)
-- without each module inventing its own delivery mechanism. This unblocks
-- PR-13 (PR/PO hand-off notifications) and Phase 5's U007 (timekeeping
-- reminders), which both explicitly depend on this existing first.
--
-- Business-scoped like every other business-scoped table since A001: a
-- notification always belongs to exactly one business (the same one the
-- underlying record belongs to), and its RLS mirrors the restrictive
-- isolation pattern used everywhere else.

create table if not exists app_notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  recipient_user_id uuid not null references users(id) on delete cascade,
  section_code text,
  entity_table text,
  entity_id uuid,
  title text not null,
  message text,
  action_url text,
  created_by uuid references users(id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_app_notifications_recipient on app_notifications(recipient_user_id, read_at, created_at desc);
create index if not exists idx_app_notifications_business_id on app_notifications(business_id);

alter table app_notifications enable row level security;

-- Business isolation, matching the pattern every other business-scoped
-- table has carried since A001.
drop policy if exists app_notifications_business_isolation on app_notifications;
create policy app_notifications_business_isolation on app_notifications as restrictive
  using (is_super_admin() or business_id = current_business_id())
  with check (is_super_admin() or business_id = current_business_id());

-- A recipient can only ever read/update their OWN notifications -- this is
-- the guard that matters most, since the table holds no other sensitive
-- data but must never leak who-was-notified between users.
drop policy if exists app_notifications_select_own on app_notifications;
create policy app_notifications_select_own on app_notifications for select
  using (is_super_admin() or recipient_user_id = auth.uid());

drop policy if exists app_notifications_update_own on app_notifications;
create policy app_notifications_update_own on app_notifications for update
  using (is_super_admin() or recipient_user_id = auth.uid())
  with check (is_super_admin() or recipient_user_id = auth.uid());

-- Any authenticated user can INSERT a notification (the whole point is to
-- notify someone ELSE -- the next workflow role holder -- so this cannot be
-- restricted to "insert your own"); the restrictive business-isolation
-- policy above still confines every insert to the acting user's own
-- business, and the application layer (notifyWorkflowRole /
-- notifyUsers) is what decides who the legitimate recipients are.
drop policy if exists app_notifications_insert on app_notifications;
create policy app_notifications_insert on app_notifications for insert
  with check (auth.role() = 'authenticated');
