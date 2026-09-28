-- Build 64 — display names (user request, 2026-09-27): PILI -> PILI-AIRE,
-- ATON -> ATON AIRE. Only trade_name (what the app shows) changes; the codes
-- ATON / PILI stay the same because code and seed scripts refer to them.
update public.businesses set trade_name = 'PILI-AIRE', updated_at = now() where code = 'PILI';
update public.businesses set trade_name = 'ATON AIRE', updated_at = now() where code = 'ATON';
