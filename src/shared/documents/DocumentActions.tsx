'use client';
// SF-09 — "Print" and "Download PDF" for any printed document.
//
// Place <DocumentActions documentNumber="DR-2026-000002" /> INSIDE the element
// marked `data-document` (the printable sheet). Both buttons are hidden when
// printing and left out of the PDF.
//
// Print: sets document.title to the document number while the browser dialog
//   is open (so "Save as PDF" defaults to e.g. DR-2026-000002.pdf), then
//   restores the title.
// Download PDF: renders the sheet client-side (html-to-image → jsPDF, both
//   loaded on demand) into an A4 or letter PDF named by the document number.
//   Page breaks are placed between table rows / marked blocks when possible.
import { useRef, useState } from 'react';

type Paper = 'a4' | 'letter';
const PAPER_MM: Record<Paper, [number, number]> = { a4: [210, 297], letter: [215.9, 279.4] };
const MARGIN_MM = 12;
const TRANSPARENT_PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export function documentFileName(documentNumber: string | null | undefined, fallback = 'document') {
  const base = String(documentNumber || '').trim() || fallback;
  return base.replace(/[\\/:*?"<>|\s]+/g, '_');
}

export function DocumentActions({ documentNumber, paper = 'a4', className = '' }: { documentNumber?: string | null; paper?: Paper; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function sheet(): HTMLElement {
    return (ref.current?.closest('[data-document]') as HTMLElement | null) ?? document.body;
  }

  function print() {
    const previous = document.title;
    const title = documentNumber ? String(documentNumber).trim() : previous;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = previous;
      window.removeEventListener('afterprint', restore);
    };
    document.title = title;
    window.addEventListener('afterprint', restore);
    window.print();
    // Chrome/Edge/Firefox block in print() and fire afterprint; this is the safety net.
    setTimeout(restore, 3000);
  }

  async function downloadPdf() {
    setBusy(true); setError(null);
    try {
      const node = sheet();
      const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
      const top = node.getBoundingClientRect().top;
      // Candidate page-break positions (CSS px from the sheet's top): the bottom of each table row / block.
      const breaks = Array.from(node.querySelectorAll('tr, [data-pdf-block], [data-document-header]'))
        .map((el) => Math.round((el as HTMLElement).getBoundingClientRect().bottom - top))
        .filter((y) => y > 0).sort((a, b) => a - b);
      const cssWidth = node.scrollWidth; const cssHeight = node.scrollHeight;
      const scale = 2;
      const canvas = await toCanvas(node, {
        pixelRatio: scale,
        backgroundColor: '#ffffff',
        cacheBust: false,
        skipFonts: true,
        imagePlaceholder: TRANSPARENT_PX,
        width: cssWidth,
        height: cssHeight,
        filter: (n) => !(n instanceof HTMLElement && n.hasAttribute('data-doc-actions')),
      });

      const [pw, ph] = PAPER_MM[paper];
      const contentW = pw - MARGIN_MM * 2; const contentH = ph - MARGIN_MM * 2;
      const mmPerCss = contentW / cssWidth;
      const pageCss = Math.floor(contentH / mmPerCss); // page height in CSS px
      const pxPerCss = canvas.width / cssWidth;

      const pdf = new jsPDF({ unit: 'mm', format: paper, orientation: 'portrait', compress: true });
      pdf.setProperties({ title: documentNumber || document.title });
      let y = 0; let first = true;
      while (y < cssHeight - 1) {
        let end = Math.min(y + pageCss, cssHeight);
        if (end < cssHeight) {
          const fit = breaks.filter((b) => b > y + pageCss * 0.5 && b <= end);
          if (fit.length) end = fit[fit.length - 1];
        }
        const sy = Math.round(y * pxPerCss); const sh = Math.max(1, Math.round(end * pxPerCss) - sy);
        const slice = document.createElement('canvas');
        slice.width = canvas.width; slice.height = sh;
        const ctx = slice.getContext('2d');
        if (!ctx) throw new Error('Canvas is not available in this browser.');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, slice.width, slice.height);
        ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        if (!first) pdf.addPage(paper, 'portrait');
        pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_MM, MARGIN_MM, contentW, sh / pxPerCss * mmPerCss);
        first = false; y = end;
      }
      pdf.save(`${documentFileName(documentNumber || document.title)}.pdf`);
    } catch (e: any) {
      setError(e?.message ? `Could not create the PDF: ${e.message}` : 'Could not create the PDF. Use Print → Save as PDF instead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} data-doc-actions className={`flex flex-wrap items-center gap-2 print:hidden ${className}`}>
      <button type="button" className="button" onClick={print}>Print</button>
      <button type="button" className="button-secondary" onClick={downloadPdf} disabled={busy}>{busy ? 'Preparing PDF…' : 'Download PDF'}</button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
