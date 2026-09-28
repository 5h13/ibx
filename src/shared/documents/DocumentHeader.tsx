// SF-08 — one header for every printed document (DR, quotation, …), so all
// printouts look the same: logo, store name, tagline, then the store's
// address, phone and email (businesses.address / phone / email, migration
// 20261125c). The business legal name is intentionally NOT printed here.
// Server-safe (no hooks): usable from server components.
import type { ReactNode } from 'react';

export type DocumentBusiness = {
  legal_name?: string | null;
  trade_name?: string | null;
  branding?: { logo_url?: string | null; tagline?: string | null } | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
} | null | undefined;

/** Column list to select from `businesses` for a document header. */
export const DOCUMENT_BUSINESS_COLUMNS = 'legal_name,trade_name,branding,address,phone,email';

export function DocumentHeader({ business, children }: { business: DocumentBusiness; children?: ReactNode }) {
  const b = business ?? {};
  const name = b.trade_name || b.legal_name || '';
  const logo = b.branding?.logo_url || null;
  const tagline = b.branding?.tagline || null;
  const contact = [b.phone, b.email].map((v) => (v ?? '').trim()).filter(Boolean);
  return (
    <div className="mb-6 flex items-start justify-between gap-6" data-document-header>
      <div className="flex min-w-0 items-center gap-3">
        {logo && (/* eslint-disable-next-line @next/next/no-img-element */ <img src={logo} alt="" className="h-14 w-14 shrink-0 object-contain" />)}
        <div className="min-w-0">
          <div className="text-lg font-bold uppercase leading-tight">{name}</div>
          {tagline && <div className="text-xs">{tagline}</div>}
          {b.address && <div className="whitespace-pre-line text-xs">{b.address}</div>}
          {contact.length > 0 && <div className="text-xs">{contact.join(' · ')}</div>}
        </div>
      </div>
      {children && <div className="shrink-0 text-right">{children}</div>}
    </div>
  );
}
