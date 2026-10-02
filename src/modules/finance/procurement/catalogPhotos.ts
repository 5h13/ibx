// Build 60 — short-lived signed links for catalog product photos (private
// bucket). Server-only: uses the service-role client for storage signing
// only; the rows themselves were already read through RLS by the caller.
import { createAdminClient } from '@/core/auth/supabaseAdmin';
import { CATALOG_PHOTO_BUCKET } from './catalogColumns';

type PhotoRow = { photo_path?: string | null; photo_path_2?: string | null; photo_path_3?: string | null };
/** Build 76: up to three photos per item (photo_url, photo_url_2, photo_url_3). */
export async function withCatalogPhotoUrls<T extends PhotoRow>(rows: T[], seconds = 3600): Promise<(T & { photo_url: string | null; photo_url_2: string | null; photo_url_3: string | null })[]> {
  const paths = rows.flatMap((r) => [r.photo_path, r.photo_path_2, r.photo_path_3]).filter((x): x is string => Boolean(x));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await createAdminClient().storage.from(CATALOG_PHOTO_BUCKET).createSignedUrls(paths, seconds);
    for (const d of data ?? []) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl);
  }
  const u = (p?: string | null) => (p ? urls.get(p) ?? null : null);
  return rows.map((r) => ({ ...r, photo_url: u(r.photo_path), photo_url_2: u(r.photo_path_2), photo_url_3: u(r.photo_path_3) }));
}
