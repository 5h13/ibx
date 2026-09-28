'use server';
import { appError } from '@/core/errors/appError';

// U033 — Business Branding.
//
// `businesses.branding` (jsonb) has existed since A001
// (20261012_a001_multi_business_foundation.sql), which explicitly deferred
// "branding config beyond the raw jsonb column" as its own item. Until this
// build, nothing in the app read or wrote it -- confirmed by grep, zero
// references to `branding` anywhere in src/. This is that UI layer.
//
// `businesses` is a genuinely GLOBAL master (per A001 -- it is the list of
// businesses, not scoped to one), and its RLS write policy
// ("businesses write global admin only") is Global-Super-Admin-only, not
// isAdminTier() -- a Business Admin can manage things *within* their own
// business, but creating/editing the business record itself (including its
// branding) is reserved for the Global Super Admin, matching CAT-14's
// precedent for other genuinely global master data.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/core/auth/supabaseServer';
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { parseTheme, THEME_FIELDS } from '@/core/theme/brandTheme';
import { getSessionProfile } from '@/core/auth/getSessionProfile';

async function requireSuperAdmin() {
  const profile = await getSessionProfile();
  if (!profile || !profile.user.is_active) throw appError('Authentication required.');
  if (profile.user.role !== 'super_admin') throw appError('Global Super Admin access required.');
  return profile;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CONTACT_LIMITS = { address: 300, phone: 80, email: 120 } as const;

// SF-08 — address / phone / email (businesses columns, migration 20261125c).
// Same rules as the DB check constraints so the admin gets a clear message.
function readContact(formData: FormData) {
  const out: { address?: string | null; phone?: string | null; email?: string | null } = {};
  for (const key of Object.keys(CONTACT_LIMITS) as (keyof typeof CONTACT_LIMITS)[]) {
    if (!formData.has(key)) continue;
    const raw = String(formData.get(key) ?? '');
    const v = (key === 'address' ? raw.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join('\n') : raw.trim());
    if (v.length > CONTACT_LIMITS[key]) throw appError(`${key[0].toUpperCase()}${key.slice(1)} must be ${CONTACT_LIMITS[key]} characters or fewer.`);
    if (key === 'email' && v && !EMAIL.test(v)) throw appError('Email must be a valid address, e.g. sales@store.ph.');
    out[key] = v || null;
  }
  return out;
}
const LOGO_BUCKET = 'business-logos';
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

// Build 62 — the logo is uploaded (was: typed as a URL). Stored in the public
// bucket business-logos (migration 20261115): the header shows it on every
// page and it is not sensitive. Uploads go through the service role only
// after the Global Super Admin check above. The previous file is removed when
// a logo is replaced or removed. A logo URL saved before Build 62 is kept
// until a new logo is uploaded or it is removed.
export async function updateBusinessBrandingAction(formData: FormData) {
  await requireSuperAdmin();
  const businessId = String(formData.get('business_id') || '').trim();
  if (!businessId) throw appError('Business is required.');

  const primaryColorRaw = formData.has('primary_color') ? String(formData.get('primary_color') || '').trim() : null;
  if (primaryColorRaw && !HEX_COLOR.test(primaryColorRaw)) {
    throw appError('Primary color must be a 6-digit hex value, e.g. #0F172A.');
  }
  const file = formData.get('logo');
  const removeLogo = String(formData.get('remove_logo') || '') === 'true';
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) throw appError('Logo must be 2 MB or smaller.');
    if (file.type && !LOGO_TYPES.includes(file.type)) throw appError('Logo must be PNG, JPG, WebP or SVG.');
  }

  // SF-08 — validated before any logo upload so a bad value never orphans a file.
  const contact = readContact(formData);

  const db = createClient();
  const { data: current, error: ce } = await db.from('businesses').select('branding').eq('id', businessId).single();
  if (ce || !current) throw appError(ce?.message || 'Business not found.');
  const prev = (current.branding ?? {}) as Record<string, any>;

  const branding: Record<string, any> = {};
  const color = primaryColorRaw === null ? prev.primary_color : primaryColorRaw;
  if (color) branding.primary_color = color;

  // Build 63 — store theme + tagline
  const tagline = String(formData.get('tagline') ?? '').trim().slice(0, 60);
  if (tagline) branding.tagline = tagline;
  if (String(formData.get('theme_enabled') || '') === 'true') {
    const theme = parseTheme({
      preset: String(formData.get('theme_preset') || '') || undefined,
      mode: formData.get('theme_mode'),
      ...Object.fromEntries(THEME_FIELDS.map((f) => [f.key, String(formData.get(`theme_${f.key}`) || '').trim()])),
    });
    if (!theme) throw appError('Every theme colour must be a 6-digit hex value, e.g. #0F172A.');
    branding.theme = theme;
  }
  if (prev.logo_url && !removeLogo) { branding.logo_url = prev.logo_url; if (prev.logo_path) branding.logo_path = prev.logo_path; }

  const admin = createAdminClient();
  let uploadedPath: string | null = null;
  if (file instanceof File && file.size > 0) {
    const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    uploadedPath = `${businessId}/${crypto.randomUUID()}-${safe}`;
    const { error: up } = await admin.storage.from(LOGO_BUCKET).upload(uploadedPath, file, { contentType: file.type || 'image/png', upsert: false });
    if (up) throw appError(up.message);
    branding.logo_url = admin.storage.from(LOGO_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;
    branding.logo_path = uploadedPath;
  }

  // SF-08 — store contact details printed on documents (DR, quotation).
  // Only fields present in the form are changed; blank clears the value.
  const patch: Record<string, any> = { branding, ...contact };

  const { error } = await db.from('businesses').update(patch).eq('id', businessId);
  if (error) {
    if (uploadedPath) await admin.storage.from(LOGO_BUCKET).remove([uploadedPath]);
    throw appError(error.message);
  }
  // remove the old file once the new branding is saved
  if (prev.logo_path && (uploadedPath || removeLogo)) await admin.storage.from(LOGO_BUCKET).remove([prev.logo_path]);

  // The header on every page (super admin and business staff alike) reads
  // this via AuthedShell, so revalidate broadly rather than one path.
  revalidatePath('/', 'layout');
}
