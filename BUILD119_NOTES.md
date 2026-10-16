# Build 119 — Paste list: client lists, screenshots and PDFs into quotations, agent orders and goods receipts

**Deploy:** `supabase db push` (`20270119_paste_list.sql`), then commit (include the new `public/ocr` folder, about 12 MB), push, wait for Vercel "Ready".

## Where
- **Create Quotation** → **Paste list** (next to Add line). Matched items become quotation lines at engine prices; lines not found can be added as "not in catalog" (reason needed).
- **Agent app** → **Paste list** (next to the search box). Matched items go into the order basket at the client's prices; the basket opens.
- **Logistics → Goods receipt** (with a PO chosen) → **Read supplier DR (photo / PDF / text)**. Lines are matched **only to the items on that PO**; the quantities become the delivered quantities. PO lines not on the DR are taken off the receipt (with a note — use Add line if they did arrive).

## How it reads
1. **Paste text** (Messenger / Viber), **upload a JPG / PNG / PDF**, or paste a screenshot straight into the box (Ctrl+V).
   - Pictures and scanned PDFs are read on the device (Tesseract OCR); PDFs with real text are read directly. Nothing is uploaded; the reader files are served by the app itself (`public/ocr`).
   - The text appears in the box first — fix any misread word — then **Read list**.
2. Each line's quantity is read: "item - 2", "2pcs item", "item x2", "(3) item", "item: 4pcs", "item 1". No quantity → 1 (box marked amber). Amounts like ₱1,250.00 / 85.00 and DR footers (TOTAL, prepared by …) are ignored.
3. Each line is matched to the catalog by its words, in name, code, brand, description, category and **specification**: part numbers (9A96, 35uF) count most; "exp" fits "EXPANSION". Greetings and filler (hi boss, pa quote po, magkano, salamat) are ignored.
4. Review table: **Matched** / **Choose one** / **Not found**, the top 5 choices per line, the words the item does not contain, and the quantity. A weak match (fewer than half the words) is left on "skip" until you choose.
5. **Add N lines.** Your picks are **remembered for the store** (★), so the same words match directly next time.

## Checks
- typecheck and production build pass.
- Database: full replay, proofs 78–118 and the new proof 119 (13 checks) all pass — `tests/db-harness/runall119.sh`.
- The picture reader and PDF reader were tried in a browser with the app's own files: a screenshot of "innova evaporator old - 2 / cabin innova - 1 / exp valve 9a96 - 2" and a supplier DR PDF were both read correctly.
- Handwriting and blurry photos read poorly — the text box is there to correct them.
