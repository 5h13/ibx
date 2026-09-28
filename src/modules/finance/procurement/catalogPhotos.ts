// Build 60 — short-lived signed links for catalog product photos (private
// bucket). Server-only: uses the service-role client for storage signing
// only; the rows themselves were already read through RLS by the caller.
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { CATALOG_PHOTO_BUCKET } from './catalogColumns';

export async function withCatalogPhotoUrls<T extends { photo_path?: string | null }>(rows: T[], seconds = 3600): Promise<(T & { photo_url: string | null })[]> {
  const paths = rows.map((r) => r.photo_path).filter((x): x is string => Boolean(x));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await createAdminClient().storage.from(CATALOG_PHOTO_BUCKET).createSignedUrls(paths, seconds);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  return rows.map((r) => ({ ...r, photo_url: r.photo_path ? urls.get(r.photo_path) ?? null : null }));
}
