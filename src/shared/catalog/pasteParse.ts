// Build 119 — reads a pasted client list (Messenger / Viber) into lines with a quantity.
// "innova evaporator old - 2", "2pcs blower motor innova", "blower motor x2", "(1) fan motor vios", "cabin innova 1".
// A line with no quantity gets 1. Bullets and numbering ("-", "*", "•", "1.", "1)") are dropped.
export type PastedLine = { raw: string; text: string; quantity: number; qtyFound: boolean };

const UNIT = '(?:pcs?|pc\\.?|pz|units?|sets?|x)';

export function parsePastedList(input: string): PastedLine[] {
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
