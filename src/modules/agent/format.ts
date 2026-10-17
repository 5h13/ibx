// Build 129 (UIA-22): peso formatting usable on the server and in the browser. It used to live only
// in AgentHeader ('use client'), so the agent Quotations page (a server page) failed with
// "Attempted to call peso() from the server" as soon as the agent had a quotation.
export const peso = (v: unknown) => (v == null || v === '' ? '—' : `₱${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
