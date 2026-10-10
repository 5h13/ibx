// Build 97g — read every row of a list. The Supabase API returns at most 1,000 rows per request,
// so a plain select silently drops the rest; this asks page by page until a short page comes back.
// The query must have a stable order (end it with the id) so no row is skipped or repeated.
type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T = any>(page: (from: number, to: number) => Page<T>, size = 1000, max = 200000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
