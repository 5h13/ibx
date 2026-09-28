-- ============================================================================
-- A001 follow-up: real business structure
--
-- Per direction, the actual multi-business structure is:
--   main / global — "5H13 Business Solutions": the Global Super Admin's own
--     organizational identity, NOT a tenant. It gets no row in
--     public.businesses and no business_id — the Global Super Admin already
--     has business_id = null and bypasses RLS via is_super_admin(), which is
--     exactly the "operates above all businesses" behavior this label means.
--   business 1 — Pili-Aire Aircon & Refrigeration Parts Trading ("Pili")
--   business 2 — Aton Aire Trading Corporation ("Aton")
--   business 3 — Ishabella HVACR Supplies ("Ishabella") — this is the
--     existing seeded business (code ISHABELLA) that every pre-A001 row in
--     the database is already attached to. It is renamed in place, not
--     recreated, so no existing data is duplicated or reassigned.
-- ============================================================================

update public.businesses
set legal_name = 'Ishabella HVACR Supplies',
    trade_name = 'Ishabella',
    updated_at = now()
where code = 'ISHABELLA';

insert into public.businesses (code, legal_name, trade_name)
values
  ('PILI', 'Pili-Aire Aircon & Refrigeration Parts Trading', 'Pili'),
  ('ATON', 'Aton Aire Trading Corporation', 'Aton')
on conflict (code) do nothing;
