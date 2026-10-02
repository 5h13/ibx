// LOG-40/41/35/26: stock-ledger filters shared by the inventory page, the
// CSV export route and the client (URL building). Pure — no server imports.
export const LEDGER_PAGE_SIZE = 50;
export const MOVEMENT_TYPES = ['receipt', 'issue', 'transfer_in', 'transfer_out', 'adjustment'] as const;

export type LedgerSearchParams = { q?: string; type?: string; location?: string; item?: string; from?: string; to?: string; page?: string };
export type LedgerFilters = { q: string; type: string; location: string; item: string; from: string; to: string; page: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ledgerFilters(sp: LedgerSearchParams | URLSearchParams): LedgerFilters {
  const get = (k: keyof LedgerSearchParams) => String((sp instanceof URLSearchParams ? sp.get(k) : sp[k]) ?? '').trim();
  const type = get('type');
  const page = Math.max(1, Math.floor(Number(get('page')) || 1));
  return {
    q: get('q').slice(0, 100),
    type: (MOVEMENT_TYPES as readonly string[]).includes(type) ? type : '',
    location: UUID.test(get('location')) ? get('location') : '',
    item: UUID.test(get('item')) ? get('item') : '',
    from: DATE.test(get('from')) ? get('from') : '',
    to: DATE.test(get('to')) ? get('to') : '',
    page,
  };
}

/** Query string for the ledger (tab included unless `forExport`). */
export function ledgerQuery(f: Partial<LedgerFilters>, forExport = false): string {
  const p = new URLSearchParams();
  if (!forExport) p.set('tab', 'ledger');
  for (const k of ['q', 'type', 'location', 'item', 'from', 'to'] as const) if (f[k]) p.set(k, String(f[k]));
  if (!forExport && f.page && f.page > 1) p.set('page', String(f.page));
  return p.toString();
}
