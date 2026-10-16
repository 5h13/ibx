// Build 119 — reads a pasted client list (Messenger / Viber) into lines with a quantity.
// "innova evaporator old - 2", "2pcs blower motor innova", "blower motor x2", "(1) fan motor vios", "cabin innova 1".
// A line with no quantity gets 1. Bullets and numbering ("-", "*", "•", "1.", "1)") are dropped.
export type PastedLine = { raw: string; text: string; quantity: number; qtyFound: boolean; /** Build 120: the unit price (rate) on a supplier DR row, when read */ price?: number | null };

const UNIT = '(?:pcs?|pc\\.?|pz|units?|sets?|x)';

// A supplier DR / invoice row read from a photo or PDF:
//   "SD-1271 | Soft Drawn 1/2" x 0.71mm x 15M (standard) S09 4| pc 3,636.00 14,544.00"
//   → stock code, description, location code, quantity, unit (OCR often reads "pc" as "pe"), then rate and amount.
const ROW_UNIT = '(?:p[ce][cs]?|pz|units?|sets?|rolls?|box(?:es)?|lots?|kgs?|ft|ea|mtrs?|meters?|m|prs?|pairs?|bags?|cans?|gal)';
// quantity as read from a photo: OCR turns 5 into S, 0 into O, 1 into I / l
const ROW = new RegExp(`^(.+)\\s+([0-9SOoIl]{1,4})\\s*[|\\])}!(]?\\s*${ROW_UNIT}\\b\\.?((?:\\s+\\S{0,12}){0,4})$`, 'i');
const qtyOf = (q: string) => Number(q.replace(/[Ss]/g, '5').replace(/[Oo]/g, '0').replace(/[Il]/g, '1'));

function tableRow(s: string): { text: string; quantity: number } | null {
  const t = s.replace(/[|{}\[\]_~=“”‘’—–!]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (/@|\btel\b|e-?mail|\btotal\b/i.test(t)) return null;                                         // letterhead / totals
  const m = t.match(ROW);
  if (!m || !/\d/.test(m[2]) && m[2].length < 2) return null;
  // after the unit only prices / amounts (or smudges) may follow — not more words
  if (/[a-z]{4,}/i.test(m[3] ?? '')) return null;
  const quantity = qtyOf(m[2]);
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  let text = m[1].trim();
  text = text.replace(/\s+(?:[A-Z$0-9]{2,7}|TBA|N\/A)$/, (x) => (/\d/.test(x) || /TBA|N\/A/.test(x) ? '' : x));  // location code before the quantity (S11, T02E, G18D01, TBA)
  text = text.replace(/^[A-Z0-9$]{1,3}[-.][A-Z0-9]{3,6}\s+(?=[A-Za-z(])/i, '');                    // the supplier's stock code (SD-1471)
  text = text.replace(/(?:\s+[a-z0-9]{1,3}[,.]?)+$/i, (x) => (/[a-z]{4,}/i.test(x) ? x : ''));    // stray handwriting marks at the end ("4,", "Yo b 9")
  text = text.replace(/^[\s(\[{|]+/, '').replace(/[\s\p{Pd}\u2500-\u257F~_.,;:'"`/(]+$/u, '').replace(/[\s\p{Pd}\u2500-\u257F_]{2,}/gu, ' ');            // leftover rule lines / dashes
  return /[a-z]{3,}/i.test(text) ? { text: text.trim(), quantity } : null;
}

export function parsePastedList(input: string): PastedLine[] {
  // A supplier document (several item rows carrying amounts or stock codes): keep only its item rows and drop the
  // letterhead, address and totals. A plain client list ("fan motor 2 pcs") never switches to this.
  // amounts: 1,699.00 / 85.00 / a smudged 14,54400 — not sizes like 0.028" or 0.71mm
  const MONEY = /(?:₱|php\s?)?(?:\d{1,3}(?:,\d{3})+(?:[.,]\d{2,})?|\d+\.\d{2})(?![\d"'a-z])/gi;
  const rows = input.replace(/\r/g, '').split('\n').map((l) => {
    const row = tableRow(l.replace(MONEY, ' '));
    const doc = !!row && (/\d[.,]\d{2}\b/.test(l) || /^\s*[A-Z0-9$]{1,3}[-.][A-Z0-9]{3,6}\b/i.test(l));
    return { raw: l.trim(), row, doc };
  });
  if (rows.filter((r) => r.doc).length >= 3) {
    // the rate is the first clean amount on the row ("1,699.00  6,796.00" → 1,699.00)
    const rate = (l: string) => { const a = l.match(/\b\d{1,3}(?:,\d{3})*\.\d{2}(?![\d"'a-z])/i); const n = a ? Number(a[0].replace(/,/g, '')) : NaN; return n > 0 ? n : null; };
    return rows.filter((r) => r.row).map((r) => ({ raw: r.raw, text: r.row!.text, quantity: r.row!.quantity, qtyFound: true, price: rate(r.raw) }));
  }
  const out: PastedLine[] = [];
  for (const rawLine of input.replace(/\r/g, '').split(/\n|;/)) {
    let s = rawLine.replace(/[​ ]/g, ' ').trim();
    if (!s) continue;
    s = s.replace(/^\s*(?:[-*•·▪►>]+|\d{1,3}[.)]\s+)\s*/, '').trim();    // bullets / numbering ("1. ", "2) ")
    // amounts on a supplier DR / price list (₱1,250.00, 85.00) are not part of the item: drop them
    s = s.replace(/(?:₱|php\s?|p\s?)?\d{1,3}(?:,\d{3})*\.\d{2}\b/gi, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!/[a-z]/i.test(s)) continue;                                      // nothing but numbers or symbols
    let qty: number | null = null;
    let m: RegExpMatchArray | null;
    if ((m = s.match(new RegExp(`^\\((\\d{1,4})\\)\\s*(.+)$`, 'i')))) { qty = Number(m[1]); s = m[2]; }                                  // (1) fan motor
    else if ((m = s.match(new RegExp(`^(\\d{1,4})\\s*${UNIT}\\.?\\s+(.+)$`, 'i')))) { qty = Number(m[1]); s = m[2]; }                     // 2pcs blower / 2 x blower
    else if ((m = s.match(new RegExp(`^(.+?)\\s*[-–—:=@]\\s*(\\d{1,4})\\s*${UNIT}?\\.?$`, 'i')))) { qty = Number(m[2]); s = m[1]; }       // item - 2 / item: 2pcs
    else if ((m = s.match(new RegExp(`^(.+?)\\s+[x×]\\s*(\\d{1,4})$`, 'i')))) { qty = Number(m[2]); s = m[1]; }                           // item x2
    else if ((m = s.match(new RegExp(`^(.+?)\\s+(\\d{1,4})\\s*${UNIT}\\.?$`, 'i')))) { qty = Number(m[2]); s = m[1]; }                    // item 2pcs
    else if ((m = s.match(/^(\d{1,4})\s+([a-z].+)$/i))) { qty = Number(m[1]); s = m[2]; }                                                  // 2 blower motor
    else if ((m = s.match(/^(.*[a-z].*?)\s+(\d{1,3})$/i))) { qty = Number(m[2]); s = m[1]; }                                               // cabin innova 1
    const text = s.replace(/\s+/g, ' ').replace(/[-–—:,]+$/, '').trim();
    if (!text) continue;
    out.push({ raw: rawLine.trim(), text, quantity: qty && qty > 0 ? qty : 1, qtyFound: !!qty && qty > 0 });
  }
  return out;
}
