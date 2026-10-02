// Build 77 (CAT-07) — minimal, dependency-free .xlsx reader for the catalog
// import. Reads the FIRST worksheet of a workbook into rows of strings, the
// same shape the CSV parser returns. Server-only (uses node:zlib to inflate).
//
// An .xlsx file is a zip of XML parts: xl/workbook.xml lists the sheets,
// xl/_rels/workbook.xml.rels maps them to files, xl/sharedStrings.xml holds
// the text cells and xl/worksheets/sheetN.xml the cells. Formulas are read
// as their cached value (what Excel shows). Number cells are returned as
// plain decimal text (no thousands separators), booleans as TRUE / FALSE.

import { inflateRawSync } from 'node:zlib';

type ZipEntry = { name: string; method: number; compressedSize: number; offset: number };

function readZip(buf: Buffer): Map<string, ZipEntry> {
  // end of central directory record (search backwards over a possible comment)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('The .xlsx file is damaged (central directory).');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name.replace(/^\/+/, ''), { name, method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf: Buffer, e: ZipEntry): string {
  if (buf.readUInt32LE(e.offset) !== 0x04034b50) throw new Error('The .xlsx file is damaged (local header).');
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const raw = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return raw.toString('utf8');
  if (e.method === 8) return inflateRawSync(raw).toString('utf8');
  throw new Error('The .xlsx file uses an unsupported compression method. Save it again from Excel.');
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, k: string) =>
    k[0] === '#' ? String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10)) : ENTITIES[k]);
}
/** All <t> text inside a fragment (handles rich-text runs; skips phonetic <rPh> runs). */
function textOf(fragment: string): string {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ?? '';
  return unescapeXml(out);
}
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : null;
}
function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  // Excel stores binary doubles: show what the cell shows (15 significant digits)
  return String(Number(n.toPrecision(15)));
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

/** Rows of the first worksheet (trimmed strings; fully blank rows removed). */
export function readXlsxRows(data: ArrayBuffer | Buffer): string[][] {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const zip = readZip(buf);
  const get = (path: string) => { const e = zip.get(path); return e ? readEntry(buf, e) : null; };

  // first sheet of the workbook
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const workbook = get('xl/workbook.xml');
  const rels = get('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const firstSheet = workbook.match(/<sheet\b[^>]*>/);
    const rid = firstSheet ? (attr(firstSheet[0], 'r:id') ?? attr(firstSheet[0], 'id')) : null;
    if (rid) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], 'Id') === rid) { const t = attr(m[0], 'Target'); if (t) sheetPath = resolvePath('xl/workbook.xml', t); break; }
      }
    }
  }
  const sheet = get(sheetPath);
  if (!sheet) throw new Error('The .xlsx file has no worksheet.');

  const shared: string[] = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] ?? ''));

  const rows: string[][] = [];
  const sheetData = sheet.match(/<sheetData>([\s\S]*?)<\/sheetData>/)?.[1] ?? '';
  let nextRow = 0;
  for (const rm of sheetData.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = attr(`<row ${rm[1]}>`, 'r');
    const rowIndex = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = rowIndex + 1;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const open = `<c ${cm[1]}>`;
      const ref = attr(open, 'r');
      const ci = ref ? colIndex(ref) : nextCol;
      nextCol = ci + 1;
      const type = attr(open, 't') ?? 'n';
      const inner = cm[2] ?? '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = '';
      if (type === 's') value = v != null ? shared[Number(v)] ?? '' : '';
      else if (type === 'inlineStr') value = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '');
      else if (type === 'b') value = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (type === 'str' || type === 'e') value = v != null ? unescapeXml(v) : '';
      else value = v != null && v.trim() !== '' ? numberText(unescapeXml(v)) : '';
      while (cells.length < ci) cells.push('');
      cells[ci] = value.trim();
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** True when the bytes look like a zip (an .xlsx), not text. */
export function looksLikeXlsx(data: ArrayBuffer | Buffer): boolean {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return b.length > 4 && b.readUInt32LE(0) === 0x04034b50;
}
