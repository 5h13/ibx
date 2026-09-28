-- SF-08 — store contact details for printed documents (DR, quotation, …).
--
-- `businesses` had no address / phone / email (checked: columns were id, code,
-- legal_name, trade_name, is_active, branding, created_at, updated_at,
-- vat_registered; branding jsonb holds logo_url / tagline / theme only).
-- The shared document header (src/shared/documents/DocumentHeader.tsx) prints
-- them under the store name, logo and tagline.
--
-- Edit path: Admin → Businesses (Branding), server action
-- updateBusinessBrandingAction, using the RLS-bound Supabase client. No new
-- policy is needed: the existing policies already give exactly the branding
-- rules —
--   "businesses write global admin only"   (ALL, is_super_admin())
--   "businesses read own or global admin"  (SELECT, own business or super admin)
-- so the Global Super Admin edits any store's contact details, a Business
-- Admin / staff can read their own store's (for printing) and cannot edit any
-- business record, and nobody reads another business's row.

alter table public.businesses add column if not exists address text;
alter table public.businesses add column if not exists phone text;
alter table public.businesses add column if not exists email text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_address_len_chk') then
    alter table public.businesses add constraint businesses_address_len_chk check (address is null or char_length(address) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_phone_len_chk') then
    alter table public.businesses add constraint businesses_phone_len_chk check (phone is null or char_length(phone) <= 80);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'businesses_email_chk') then
    alter table public.businesses add constraint businesses_email_chk
      check (email is null or (char_length(email) <= 120 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
  end if;
end $$;

comment on column public.businesses.address is 'Store address printed on documents (SF-08). Edited in Admin → Businesses.';
comment on column public.businesses.phone is 'Store phone number(s) printed on documents (SF-08).';
comment on column public.businesses.email is 'Store email printed on documents (SF-08).';
