"use client";
// Build 115 — UIA-21: full price history of an item, shown under a quotation line.
// (1) store price / SRP changes, (2) cost changes, (3) purchase prices per supplier, (4) this customer's past prices.
import { useEffect, useState } from "react";
import { errorText } from "@/core/errors/appError";
import { itemPriceHistoryAction } from "./revenueActions";

const money = (n: any) => (n === null || n === undefined || n === "" ? "—" : `₱${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const day = (d: any) => (d ? new Date(d).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }) : "—");
const TABS = [
  { k: "srp", label: "Store price (SRP)" },
  { k: "cost", label: "Cost" },
  { k: "purchases", label: "Purchases" },
  { k: "customer", label: "This customer" },
] as const;

function Rows({ head, rows, empty }: { head: string[]; rows: (string | number | null)[][]; empty: string }) {
  if (!rows.length) return <p className="p-2 text-slate-500">{empty}</p>;
  return (
    <div className="max-h-64 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-white"><tr className="border-b text-left uppercase text-slate-500">{head.map((h) => <th key={h} className="p-1">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b">{r.map((c, j) => <td key={j} className="p-1">{c ?? "—"}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function PriceHistoryPanel({ itemId, customerId }: { itemId: string; customerId: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]["k"]>("srp");
  useEffect(() => {
    let live = true;
    setData(null); setError("");
    itemPriceHistoryAction(itemId, customerId || null).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [itemId, customerId]);
  if (error) return <p className="rounded border p-2 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="rounded border p-2 text-sm text-slate-500">Loading price history…</p>;
  const cur = data.current ?? {};
  return (
    <div className="space-y-2 rounded border bg-white p-2 text-sm">
      <div className="flex flex-wrap gap-x-4 text-xs text-slate-600">
        <span className="font-medium text-slate-800">{data.item?.code} · {data.item?.name}</span>
        <span>Now: SRP {money(cur.srp)}</span><span>cost {money(cur.supplier_cost)}</span><span>acquisition {money(cur.acquisition_cost)}</span>
        <span>add-on {Number(cur.category_addon_percent ?? 0)}% · markup {Number(cur.item_markup_percent ?? 0)}%</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.k} type="button" className={tab === t.k ? "button-sm" : "rounded border px-2 py-0.5 text-xs"} onClick={() => setTab(t.k)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "srp" && (
        <Rows head={["When", "Change", "Cost", "Add-on", "Markup", "SRP", "By"]} empty="No price changes recorded for this store."
          rows={(data.srp_changes ?? []).map((r: any) => [day(r.at), r.what, money(r.cost), r.addon_percent == null ? "—" : `${Number(r.addon_percent)}%`, r.markup_percent == null ? "—" : `${Number(r.markup_percent)}%`, money(r.srp), r.by])} />
      )}
      {tab === "cost" && (
        <Rows head={["When", "From", "To", "Supplier", "Source", "By"]} empty="No cost changes recorded."
          rows={(data.cost_changes ?? []).map((r: any) => [day(r.at), money(r.previous), money(r.cost), r.supplier, [r.source, r.note].filter(Boolean).join(" · "), r.by])} />
      )}
      {tab === "purchases" && (
        <Rows head={["Date", "Supplier", "Supplier code", "PO", "Qty", "PO price", "Invoice price", "Price"]} empty="No purchases recorded for this store."
          rows={(data.purchases ?? []).map((r: any) => [day(r.date), r.supplier, r.supplier_item_code, r.po_number, r.quantity == null ? null : `${Number(r.quantity)} ${r.unit ?? ""}`, money(r.po_price), money(r.invoice_price), money(r.price)])} />
      )}
      {tab === "customer" && (
        customerId ? (
          <Rows head={["Date", "", "Document", "Status", "Qty", "Price"]} empty="This customer has no earlier quotations or purchases of this item."
            rows={(data.customer ?? []).map((r: any) => [day(r.date), r.kind === "sold" ? "Sold" : "Quoted", r.document, String(r.status ?? "").replaceAll("_", " "), Number(r.quantity), money(r.price)])} />
        ) : <p className="p-2 text-slate-500">Choose the customer first.</p>
      )}
    </div>
  );
}
