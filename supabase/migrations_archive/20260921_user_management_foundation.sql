-- IBX Super Admin / User Management foundation
-- Safe to run after the base schema.
create index if not exists user_access_user_section_idx on public.user_access (user_id, section_id);
create index if not exists users_active_role_idx on public.users (role, is_active);
