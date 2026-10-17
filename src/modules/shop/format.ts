// Build 137 — formatting shared by the shop's server and browser code (no server imports here).
export const pesoShop = (n: number | null | undefined) => (n == null ? null : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

/** +63 form for Viber links. */
export function viberIntl(n: string | null | undefined) {
  if (!n) return null;
  const d = n.replace(/[^\d]/g, '');
  if (d.startsWith('63')) return `+${d}`;
  if (d.startsWith('0')) return `+63${d.slice(1)}`;
  return `+${d}`;
}

export const shortDay = (d: string | null | undefined) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : '');
