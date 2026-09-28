// SF-09 — print layout for documents on regular paper (A4 or letter; no
// thermal layout). `size: portrait` only sets the orientation, so the paper
// size stays selectable in the print dialog (a fixed `size: A4` would lock
// letter-paper users out). Buttons and anything marked print:hidden /
// data-doc-actions are hidden; the page prints on white edge to edge of the
// margins.
export const DOCUMENT_PAGE_CLASS = 'doc-page';

const CSS = `
@page { size: portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  [data-doc-actions] { display: none !important; }
  .${DOCUMENT_PAGE_CLASS} { max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important; box-shadow: none !important; }
  .${DOCUMENT_PAGE_CLASS} tr, .${DOCUMENT_PAGE_CLASS} [data-pdf-block] { break-inside: avoid; }
  .${DOCUMENT_PAGE_CLASS} thead { display: table-header-group; }
}
`;

export function DocumentPrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}
