-- Build 91 — agent logins get their own system role (own migration: a new
-- enum value cannot be used in the same transaction that adds it).
alter type public.app_role add value if not exists 'agent';
