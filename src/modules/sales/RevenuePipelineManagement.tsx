"use client";
import { Form } from '@/core/ui/Form';
import { errorText } from "@/core/errors/appError";
import { CatalogItemPicker } from "@/shared/catalog/CatalogItemPicker";
import { costAgeLabel } from "@/modules/finance/procurement/supplierQuoteAccess";
import { useEffect, useState, useTransition } from "react";
import { useDialog } from "@/core/ui/Dialog";
import { ActionBar, PopupAction, usePopupClose } from "@/core/ui/PopupAction";
import {
  acceptQuotationAction,
  approveQuotationAction,
  approveSalesOrderAction,
  createCommissionAction,
  createOpportunityAction,
  createQuotationAction,
  markQuotationSentAction,
  prepareQuotationAction,
  prepareSalesOrderAction,
  reviewQuotationAction,
  reviewSalesOrderAction,
  updateOpportunityStatusAction,
  createRevenueRecognitionDraftAction,
  refreshSalesMonthlySummaryAction,
  quoteStockAction,
} from "./revenueActions";
import { GoSignalForm, ORDERABLE, OrderView, QuoteView } from "./QuoteChain";
import { CustomerBox } from "./storefront/CustomerBox";
import { addCustomerAction } from "./storefront/actions";
const money = (n: any) => `₱${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function RevenuePipelineManagement({
  opportunities,
  quotations,
  orders,
  commissions,
  customers,
  leads,
  locations,
  employees,
  recognitions,
  monthlySummary,
  catalogItems,
  categoryPricing,
  itemPricing,
  customerDiscounts,
}: {
  opportunities: any[];
  quotations: any[];
  orders: any[];
  commissions: any[];
  customers: any[];
  leads: any[];
  locations: any[];
  employees: any[];
  recognitions: any[];
  monthlySummary: any[];
  catalogItems: any[];
  categoryPricing: any[];
  itemPricing: any[];
  customerDiscounts: any[];
}) {
  const dialog = useDialog();
  const [tab, setTab] = useState("pipeline");
  // Build 82: ?tab=quotations (5H13 Shortcuts)
  const [highlight, setHighlight] = useState('');
  useEffect(() => { const q = new URLSearchParams(window.location.search); const t = q.get('tab'); if (t === 'quotations' || t === 'orders') setTab(t); const o = q.get('order'); if (o) setHighlight(o); }, []);
  useEffect(() => { if (tab === 'orders' && highlight) document.getElementById(`so-${highlight}`)?.scrollIntoView({ block: 'center' }); }, [tab, highlight]);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const hasOpenOrder = (quotationId: string) => orders.some((o) => o.quotation_id === quotationId && o.status !== "cancelled");
  const run = (f: () => Promise<any>) => start(() => f().catch((e) => dialog.alert(errorText(e), { tone: "danger", title: "Action failed" })));
  return (
    <div className="space-y-5">
      {message && (
        <div className="flex items-start justify-between gap-3 rounded border bg-white p-3 text-sm">
          <span>{message}</span>
          <button className="text-xs text-slate-500" onClick={() => setMessage("")}>
            Dismiss
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ["Open Opportunities", opportunities.filter((x) => !["won", "lost", "cancelled"].includes(x.status)).length],
          [
            "Pipeline Value",
            money(opportunities.filter((x) => x.status !== "lost" && x.status !== "cancelled").reduce((s, x) => s + Number(x.estimated_value || 0), 0)),
          ],
          ["Quotations", quotations.filter((q) => q.status !== "superseded").length],
          ["Orders", orders.length],
          ["Commissions", money(commissions.reduce((s, x) => s + Number(x.commission_amount || 0), 0))],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-xl border bg-white p-4">
            <div className="text-sm text-slate-500">{l}</div>
            <div className="text-xl font-semibold">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-b overflow-x-auto">
        {[
          ["pipeline", "Pipeline"],
          ["quotations", "Quotations"],
          ["orders", "Sales Orders"],
          ["revenue", "AR / Revenue"],
          ["commissions", "Commissions"],
        ].map(([k, l]) => (
          <button
            key={k}
            className={`px-4 py-2 text-sm whitespace-nowrap ${tab === k ? "border-b-2 border-slate-800 font-semibold" : ""}`}
            onClick={() => setTab(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "pipeline" && (
        <>
          <ActionBar>
            <PopupAction label="+ Create opportunity" title="Create opportunity" wide>
              {(close) => (
                <Form
                  action={(fd) =>
                    run(async () => {
                      await createOpportunityAction(fd);
                      close();
                    })
                  }
                  className="grid md:grid-cols-4 gap-3"
                >
                  <Field l="Opportunity no.">
                    <input className="input" name="opportunity_number" placeholder="OPP-2026-001" required />
                  </Field>
                  <Field l="Opportunity name">
                    <input className="input" name="opportunity_name" required />
                  </Field>
                  <Field l="Lead">
                    <select className="input" name="lead_id">
                      <option value="">None</option>
                      {leads.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.lead_code} — {x.contact_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field l="Customer">
                    <select className="input" name="customer_id">
                      <option value="">Prospect / none</option>
                      {customers
                        .filter((x) => x.active)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.customer_code} — {x.legal_name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field l="Expected close">
                    <input className="input" type="date" name="expected_close_date" />
                  </Field>
                  <Field l="Estimated value">
                    <input className="input" type="number" step="0.01" name="estimated_value" defaultValue="0" />
                  </Field>
                  <Field l="Probability %">
                    <input className="input" type="number" step="0.01" name="probability" defaultValue="0" />
                  </Field>
                  <Field l="Source">
                    <input className="input" name="source" placeholder="Referral / campaign / direct" />
                  </Field>
                  <div className="md:col-span-4">
                    <button className="button" disabled={pending}>
                      Save opportunity
                    </button>
                  </div>
                </Form>
              )}
            </PopupAction>
          </ActionBar>
          <Card title="Sales pipeline">
            <Table
              headers={["Opportunity", "Customer", "Value", "Probability", "Close", "Status", "Action"]}
              rows={opportunities.map((x) => (
                <tr key={x.id} className="border-b">
                  <td className="p-3 font-medium">
                    {x.opportunity_number}
                    <div className="text-xs text-slate-500">{x.opportunity_name}</div>
                  </td>
                  <td className="p-3">{x.customer?.legal_name || "Prospect"}</td>
                  <td className="p-3">{money(x.estimated_value)}</td>
                  <td className="p-3">{x.probability}%</td>
                  <td className="p-3">{x.expected_close_date || "—"}</td>
                  <td className="p-3">
                    <Badge s={x.status} />
                  </td>
                  <td className="p-3">
                    <select
                      className="input"
                      value={x.status}
                      disabled={pending}
                      onChange={(e) => run(() => updateOpportunityStatusAction(x.id, e.target.value))}
                    >
                      {["open", "qualified", "proposal", "won", "lost", "cancelled"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            />
          </Card>
        </>
      )}
      {tab === "quotations" && (
        <>
          <ActionBar>
            <PopupAction label="+ Create quotation" title="Create quotation" wide openParam="quote">
              <QuotationForm
                customers={customers}
                opportunities={opportunities}
                catalogItems={catalogItems}
                categoryPricing={categoryPricing}
                itemPricing={itemPricing}
                customerDiscounts={customerDiscounts}
                pending={pending}
                run={run}
              />
            </PopupAction>
          </ActionBar>
          <Card title="Quotation register">
            <label className="mb-3 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={showSuperseded} onChange={(e) => setShowSuperseded(e.target.checked)} /> Show superseded revisions
            </label>
            <Table
              headers={["Quotation", "Customer", "Date", "Total", "Status", "Actions"]}
              rows={quotations
                .filter((q) => showSuperseded || q.status !== "superseded")
                .map((q) => (
                  <tr key={q.id} className="border-b">
                    <td className="p-3 font-medium">
                      {q.quotation_number}
                      {q.revision > 0 && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">Rev {q.revision}</span>}
                    </td>
                    <td className="p-3">{q.customer?.legal_name || "—"}</td>
                    <td className="p-3">{q.quotation_date}</td>
                    <td className="p-3">{money(q.total_amount)}</td>
                    <td className="p-3">
                      <Badge s={q.status} />
                    </td>
                    <td className="p-3 flex gap-1 flex-wrap">
                      <PopupAction label="View" title={`Quotation ${q.quotation_number}`} variant="secondary" wide>
                        {(close) => (
                          <QuoteView
                            quotationId={q.id}
                            onRevised={(m) => {
                              setMessage(m);
                              close();
                            }}
                          />
                        )}
                      </PopupAction>
                      {q.status === "draft" && (
                        <button className="button-sm" onClick={() => run(() => prepareQuotationAction(q.id))}>
                          Prepare
                        </button>
                      )}
                      {q.status === "prepared" && (
                        <button className="button-sm" onClick={() => run(() => reviewQuotationAction(q.id, true))}>
                          Review
                        </button>
                      )}
                      {q.status === "reviewed" && (
                        <button className="button-sm" onClick={() => run(() => approveQuotationAction(q.id))}>
                          Approve
                        </button>
                      )}
                      {q.status === "approved" && (
                        <button className="button-sm" onClick={() => run(() => markQuotationSentAction(q.id))}>
                          Send
                        </button>
                      )}
                      {q.status === "sent" && (
                        <button className="button-sm" onClick={() => run(() => acceptQuotationAction(q.id))}>
                          Accept
                        </button>
                      )}
                      {ORDERABLE.includes(q.status) && !hasOpenOrder(q.id) && (
                        <PopupAction label="Create order" title={`Client go-signal · ${q.quotation_number}`} wide>
                          {(close) => (
                            <GoSignalForm
                              quote={q}
                              onDone={(m) => {
                                setMessage(m);
                                setTab("orders");
                                close();
                              }}
                            />
                          )}
                        </PopupAction>
                      )}
                    </td>
                  </tr>
                ))}
            />
          </Card>
        </>
      )}
      {tab === "orders" && (
        <>
          <Card title="Sales orders">
            <Table
              headers={["Order", "Customer", "Client PO / go-signal", "Total", "Status", "Actions"]}
              rows={orders.map((o) => (
                <tr key={o.id} id={`so-${o.order_number}`} className={`border-b ${highlight === o.order_number ? "bg-amber-50" : ""}`}>
                  <td className="p-3 font-medium">
                    {o.order_number}
                    <div className="text-xs font-normal text-slate-500">{o.order_date}</div>
                  </td>
                  <td className="p-3">{o.customer?.legal_name || "—"}</td>
                  <td className="p-3 text-xs">
                    {o.client_po_number || (o.go_signal_via ? "No client PO" : "—")}
                    {o.go_signal_via && (
                      <div className="text-slate-500">
                        {o.go_signal_via} · {o.go_signal_date}
                      </div>
                    )}
                  </td>
                  <td className="p-3">{money(o.total_amount)}</td>
                  <td className="p-3">
                    <Badge s={o.status} />
                  </td>
                  <td className="p-3 flex gap-1 flex-wrap">
                    <PopupAction label="View" title={`Sales order ${o.order_number}`} variant="secondary" wide>
                      <OrderView orderId={o.id} />
                    </PopupAction>
                    {o.status === "draft" && (
                      <button className="button-sm" onClick={() => run(() => prepareSalesOrderAction(o.id))}>
                        Prepare
                      </button>
                    )}
                    {o.status === "prepared" && (
                      <button className="button-sm" onClick={() => run(() => reviewSalesOrderAction(o.id, true))}>
                        Review
                      </button>
                    )}
                    {o.status === "reviewed" && (
                      <button
                        className="button-sm"
                        onClick={() =>
                          run(async () => {
                            await approveSalesOrderAction(o.id);
                            setMessage(`${o.order_number} approved. Lines to order from suppliers were sent to Procurement as a PR (see View).`);
                          })
                        }
                      >
                        Approve
                      </button>
                    )}
                    {/* UIA-09: DRs for an approved order are issued at Storefront → Orders (system-numbered); the old
                        "Send to warehouse" asked the approver to type a delivery number and is removed. */}
                    {["approved", "processing"].includes(o.status) && (
                      <a className="button-sm" href="/sales/storefront?tab=orders">Issue DR at Storefront</a>
                    )}
                  </td>
                </tr>
              ))}
            />
          </Card>
        </>
      )}
      {tab === "revenue" && (
        <>
          <Card title="AR / Revenue Recognition">
            <p className="text-sm text-slate-500 mb-3">
              Generate a draft customer invoice and balanced draft revenue journal from a sales order after warehouse delivery is completed. Finance can then
              review, approve and post the accounting entry.
            </p>
            <Table
              headers={["Recognition", "Order", "Revenue", "AR Invoice", "Status", "Action"]}
              rows={recognitions.map((r) => (
                <tr key={r.id} className="border-b">
                  <td className="p-3 font-medium">{r.recognition_number}</td>
                  <td className="p-3">{r.order?.order_number || "—"}</td>
                  <td className="p-3">{money(r.revenue_amount)}</td>
                  <td className="p-3">
                    {r.invoice?.invoice_number || "—"}
                    <div className="text-xs text-slate-500">{r.invoice?.status || "—"}</div>
                  </td>
                  <td className="p-3">
                    <Badge s={r.status} />
                  </td>
                  <td className="p-3">—</td>
                </tr>
              ))}
            />
          </Card>
          <Card title="Orders ready for revenue recognition">
            <Table
              headers={["Order", "Customer", "Total", "Status", "Action"]}
              rows={orders
                .filter((o) => ["processing", "fulfilled"].includes(o.status) && !recognitions.some((r) => r.sales_order_id === o.id))
                .map((o) => (
                  <tr key={o.id} className="border-b">
                    <td className="p-3 font-medium">{o.order_number}</td>
                    <td className="p-3">{o.customer?.legal_name || "—"}</td>
                    <td className="p-3">{money(o.total_amount)}</td>
                    <td className="p-3">
                      <Badge s={o.status} />
                    </td>
                    <td className="p-3">
                      <button
                        className="button-sm"
                        disabled={pending}
                        onClick={() => {
                          dialog.prompt("Recognition number", { defaultValue: `REC-${o.order_number}` }).then((rn) => {
                            if (!rn) return;
                            dialog.prompt("AR invoice number", { defaultValue: `INV-${o.order_number}` }).then((inv) => {
                              if (rn && inv) run(() => createRevenueRecognitionDraftAction(o.id, null, rn, inv));
                            });
                          });
                        }}
                      >
                        Generate AR + revenue draft
                      </button>
                    </td>
                  </tr>
                ))}
            />
          </Card>
          <Card title="Monthly revenue / commission integration">
            <div className="flex justify-end mb-3">
              <button
                className="button-sm"
                disabled={pending}
                onClick={() => {
                  const d = new Date();
                  run(() => refreshSalesMonthlySummaryAction(d.getFullYear(), d.getMonth() + 1));
                }}
              >
                Refresh current month
              </button>
            </div>
            <Table
              headers={["Period", "Fulfilled orders", "Gross revenue", "AR invoiced", "Cash collected", "Commission accrued", "Commission approved"]}
              rows={monthlySummary.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="p-3 font-medium">
                    {m.year}-{String(m.month).padStart(2, "0")}
                  </td>
                  <td className="p-3">{m.fulfilled_orders}</td>
                  <td className="p-3">{money(m.gross_revenue)}</td>
                  <td className="p-3">{money(m.ar_invoiced)}</td>
                  <td className="p-3">{money(m.cash_collected)}</td>
                  <td className="p-3">{money(m.commission_accrued)}</td>
                  <td className="p-3">{money(m.commission_approved)}</td>
                </tr>
              ))}
            />
          </Card>
        </>
      )}
      {tab === "commissions" && (
        <>
          <ActionBar>
            <PopupAction label="+ Create commission" title="Create commission" wide>
              {(close) => (
                <Form
                  action={(fd) =>
                    run(async () => {
                      await createCommissionAction(fd);
                      close();
                    })
                  }
                  className="grid md:grid-cols-4 gap-3"
                >
                  <Field l="Commission no.">
                    <input className="input" name="commission_number" placeholder="COM-2026-001" required />
                  </Field>
                  <Field l="Sales order">
                    <select className="input" name="sales_order_id" required>
                      <option value="">Select</option>
                      {orders.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.order_number} — {money(x.total_amount)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field l="Employee">
                    <select className="input" name="employee_id">
                      <option value="">None</option>
                      {employees.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.employee_no} — {x.first_name} {x.last_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field l="Rate %">
                    <input className="input" name="commission_rate" type="number" step="0.01" defaultValue="0" />
                  </Field>
                  <Field l="Commission base">
                    <input className="input" name="commission_base" type="number" step="0.01" placeholder="Order total by default" />
                  </Field>
                  <div className="md:col-span-4">
                    <button className="button" disabled={pending}>
                      Save commission
                    </button>
                  </div>
                </Form>
              )}
            </PopupAction>
          </ActionBar>
          <Card title="Commission register">
            <Table
              headers={["Commission", "Order", "Base", "Rate", "Amount", "Status"]}
              rows={commissions.map((c) => (
                <tr key={c.id} className="border-b">
                  <td className="p-3 font-medium">{c.commission_number}</td>
                  <td className="p-3">{c.order?.order_number || "—"}</td>
                  <td className="p-3">{money(c.commission_base)}</td>
                  <td className="p-3">{c.commission_rate}%</td>
                  <td className="p-3">{money(c.commission_amount)}</td>
                  <td className="p-3">
                    <Badge s={c.status} />
                  </td>
                </tr>
              ))}
            />
          </Card>
        </>
      )}
    </div>
  );
}
function QuotationForm({
  customers,
  opportunities,
  catalogItems,
  categoryPricing,
  itemPricing,
  customerDiscounts,
  pending,
  run,
}: {
  customers: any[];
  opportunities: any[];
  catalogItems: any[];
  categoryPricing: any[];
  itemPricing: any[];
  customerDiscounts: any[];
  pending: boolean;
  run: (f: () => Promise<any>) => void;
}) {
  const close = usePopupClose();
  const [customerId, setCustomerId] = useState("");
  const [terms, setTerms] = useState("");
  // Build 112 — UIA-13/14/16 + preview: searchable customer box with "+ New customer", discount in ₱ or %, live preview.
  const [custList, setCustList] = useState<any[]>(() => customers.filter((x) => x.active));
  const [adding, setAdding] = useState(false);
  const [newCust, setNewCust] = useState({ name: "", phone: "", address: "", tax_id: "" });
  const [custError, setCustError] = useState("");
  const [discMode, setDiscMode] = useState<"amount" | "percent">("amount");
  const [discValue, setDiscValue] = useState("");
  const [otherCharges, setOtherCharges] = useState("");
  const [vat, setVat] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [formError, setFormError] = useState("");
  // CAT-13: every line is a catalog item; "not in catalog" is an explicit escape that needs a reason (flagged on the quote).
  const blankLine = () => ({ catalog_item_id: "", description: "", quantity: 1, unit: "unit", unit_price: 0, not_in_catalog: false, custom_reason: "" });
  const [lines, setLines] = useState([blankLine()]);
  const [picked, setPicked] = useState<Record<string, any>>({});
  // DOC-01: stock on hand per catalog item (quantities only, this business)
  const [stock, setStock] = useState<Record<string, { store: number | null; all: number | null; type: string }>>({});
  const itemById = (id: string) => picked[id] ?? catalogItems.find((x) => x.id === id);
  const priceFor = (item: any, cust: string = customerId) => {
    if (!item) return 0;
    const cat = categoryPricing.find(
      (x) =>
        String(x.category?.name || "")
          .trim()
          .toLowerCase() ===
        String(item.category || "")
          .trim()
          .toLowerCase(),
    );
    const catPct = Number(cat?.addon_percent || 0);
    const markup = Number(itemPricing.find((x) => x.item_id === item.id)?.markup_percent || 0);
    const disc = Number(customerDiscounts.find((x) => x.customer_id === cust && x.item_id === item.id)?.discount_percent || 0);
    const acq = Number(item.standard_cost || 0) * (1 + catPct / 100);
    const srp = acq * (1 + markup / 100);
    return srp * (1 - disc / 100);
  };
  const choose = (i: number, item: any) => {
    if (item) setPicked((p) => ({ ...p, [item.id]: item }));
    if (item && !stock[item.id])
      quoteStockAction([item.id])
        .then((rows) => setStock((st) => ({ ...st, ...Object.fromEntries(rows.map((r) => [r.item_id, { store: r.on_hand_store, all: r.on_hand_business, type: r.item_type }])) })))
        .catch(() => undefined);
    setLines(
      lines.map((l, j) =>
        j === i
          ? { ...l, catalog_item_id: item?.id || "", description: item?.item_name || "", unit: item?.unit || "unit", unit_price: item ? priceFor(item) : 0, not_in_catalog: false, custom_reason: "" }
          : l,
      ),
    );
  };
  const pickCustomer = (cust: string) => {
    setCustomerId(cust);
    const t = custList.find((x) => x.id === cust)?.payment_terms;
    if (t) setTerms(t);
    setLines(
      lines.map((l) => {
        const item = l.catalog_item_id ? itemById(l.catalog_item_id) : null;
        return item ? { ...l, unit_price: priceFor(item, cust) } : l;
      }),
    );
  };
  const saveNewCustomer = () => {
    setCustError("");
    run(async () => {
      try {
        const id = await addCustomerAction({ name: newCust.name, phone: newCust.phone, address: newCust.address, tax_id: newCust.tax_id });
        setCustList((c) => [{ id, customer_code: "new", legal_name: newCust.name.trim(), phone: newCust.phone || null, address: newCust.address || null, active: true }, ...c]);
        pickCustomer(id);
        setAdding(false);
        setNewCust({ name: "", phone: "", address: "", tax_id: "" });
      } catch (e) {
        setCustError(errorText(e));
      }
    });
  };
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const lineAmount = (l: any) => r2((Number(l.quantity) || 0) * r2(Number(l.unit_price) || 0));
  const filled = lines.filter((l) => l.catalog_item_id || (l.not_in_catalog && l.description));
  const subtotal = r2(filled.reduce((t, l) => t + lineAmount(l), 0));
  const discNum = Number(discValue || 0);
  const discountAmount = discMode === "percent" ? r2((subtotal * discNum) / 100) : r2(discNum);
  const discountPct = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
  const other = r2(Number(otherCharges || 0));
  const total = r2(subtotal - discountAmount + other);
  const vatAmount = vat ? r2((total * 12) / 112) : 0;
  const discountProblem = (() => {
    if (discValue.trim() === "") return "";
    if (!Number.isFinite(discNum) || discNum < 0) return "The discount cannot be negative.";
    if (!/^\d+(\.\d{1,2})?$/.test(discValue.trim())) return "Use at most 2 decimals (e.g. 10, 12.5 or 150.75).";
    if (discMode === "percent" && discNum > 100) return "A percentage discount cannot be more than 100%.";
    if (subtotal > 0 && discountAmount > subtotal) return `The discount (${money(discountAmount)}) is more than the lines total (${money(subtotal)}).`;
    return "";
  })();
  const custName = custList.find((x) => x.id === customerId)?.legal_name;
  return (
    <Form
      onKeyDown={(e: any) => {
        // UIA-15: Enter inside a field never saves the quotation; only the Save button does.
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") e.preventDefault();
      }}
      action={(fd) => {
        setFormError("");
        if (!customerId) { setFormError("Choose the customer (or add a new one)."); return; }
        if (discountProblem) { setFormError(discountProblem); return; }
        fd.set("discount_mode", discMode);
        fd.set("discount_value", discValue.trim() || "0");
        fd.set(
          "lines",
          JSON.stringify(
            lines.map(({ not_in_catalog, ...l }) => (not_in_catalog ? { ...l, catalog_item_id: "" } : { ...l, custom_reason: undefined })),
          ),
        );
        run(async () => {
          await createQuotationAction(fd);
          close();
        });
      }}
      className="space-y-3"
    >
      <div className="grid md:grid-cols-4 gap-3">
        <Field l="Quotation no.">
          <input className="input bg-slate-50" value="Assigned when saved" readOnly tabIndex={-1} />
        </Field>
        <Field l="Customer">
          <input type="hidden" name="customer_id" value={customerId} />
          <CustomerBox customers={custList} value={customerId} onChange={pickCustomer} />
          <button type="button" className="mt-1 text-xs text-blue-700 underline" onClick={() => setAdding(!adding)}>
            {adding ? "Cancel new customer" : "+ New customer"}
          </button>
        </Field>
        <Field l="Opportunity">
          <select className="input" name="opportunity_id">
            <option value="">None</option>
            {opportunities.map((x) => (
              <option key={x.id} value={x.id}>
                {x.opportunity_number} — {x.opportunity_name}
              </option>
            ))}
          </select>
        </Field>
        <Field l="Quotation date">
          <input className="input" name="quotation_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
        </Field>
        <Field l="Valid until">
          <input className="input" name="valid_until" type="date" />
        </Field>
        <Field l="Discount (whole quotation)">
          <div className="flex gap-1">
            <select className="input w-20" value={discMode} onChange={(e) => setDiscMode(e.target.value as "amount" | "percent")} aria-label="Discount type">
              <option value="amount">₱</option>
              <option value="percent">%</option>
            </select>
            <input className={`input ${discountProblem ? "border-red-500" : ""}`} type="text" inputMode="decimal" placeholder={discMode === "percent" ? "e.g. 10" : "e.g. 500"} value={discValue} onChange={(e) => setDiscValue(e.target.value)} />
          </div>
          <div className={`text-xs ${discountProblem ? "text-red-700" : "text-slate-500"}`}>
            {discountProblem || (discountAmount > 0 ? (discMode === "percent" ? `= ${money(discountAmount)} off` : `= ${discountPct.toFixed(2)}% of the lines total`) : "Amount in pesos or a percentage of the lines total")}
          </div>
        </Field>
        <Field l="VAT (SF-03d)">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="vat_applied" value="1" checked={vat} onChange={(e) => setVat(e.target.checked)} /> With VAT — prices include 12% VAT (the sales order follows)
          </label>
        </Field>
        <Field l="Other charges">
          <input className="input" name="other_charges" type="number" min="0" step="0.01" value={otherCharges} placeholder="0" onChange={(e) => setOtherCharges(e.target.value)} />
        </Field>
        <Field l="Payment terms">
          <input className="input" name="payment_terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 30 days, COD" />
        </Field>
        <Field l="Delivery lead time">
          <input className="input" name="delivery_lead_time" placeholder="e.g. within the day, 3-5 days" />
        </Field>
      </div>
      {adding && (
        <div className="grid gap-2 rounded border p-3 sm:grid-cols-4">
          <input className="input sm:col-span-2" placeholder="Customer / company name *" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
          <input className="input" placeholder="Phone" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
          <input className="input" placeholder="TIN" value={newCust.tax_id} onChange={(e) => setNewCust({ ...newCust, tax_id: e.target.value })} />
          <input className="input sm:col-span-3" placeholder="Address" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} />
          <button type="button" className="button" disabled={pending || !newCust.name.trim()} onClick={saveNewCustomer}>Save customer</button>
          <p className="text-xs text-slate-500 sm:col-span-4">The new customer gets the store as agent (change it on the customer record) and is selected for this quotation.</p>
          {custError && <p className="text-sm text-red-700 sm:col-span-4">{custError}</p>}
        </div>
      )}
      <div className="border rounded-lg p-3 space-y-2">
        <div className="font-medium">
          Line items{" "}
          <span className="text-xs text-slate-500">
            Pick every item from the catalog (priced by the central pricing engine). An item that is not in the catalog needs a reason and is flagged on the quotation;
            it cannot be ordered from a supplier until Procurement adds it to the catalog.
          </span>
        </div>
        {lines.map((l, i) => (
          <div className="grid md:grid-cols-12 gap-2" key={i}>
            {l.not_in_catalog ? (
              <input
                className="input md:col-span-4 border-amber-400"
                placeholder="Why is this not in the catalog? (required)"
                value={l.custom_reason}
                required
                onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, custom_reason: e.target.value } : x)))}
              />
            ) : (
              <CatalogItemPicker className="md:col-span-4" value={l.catalog_item_id} onSelect={(item) => choose(i, item)} />
            )}
            <input
              className="input md:col-span-3"
              placeholder="Description"
              value={l.description}
              readOnly={!l.not_in_catalog && !l.catalog_item_id}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
            />
            <input
              className="input md:col-span-1"
              type="number"
              min="0.001"
              step="0.001"
              value={l.quantity}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))}
            />
            <input
              className="input md:col-span-2"
              placeholder="Unit"
              value={l.unit}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
            />
            <input
              className="input md:col-span-2"
              type="number"
              step="0.01"
              value={l.unit_price}
              readOnly={!l.not_in_catalog}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))}
            />
            <div className="md:col-span-12 -mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
              {!l.not_in_catalog && l.catalog_item_id && itemById(l.catalog_item_id) && <span>{costAgeLabel(itemById(l.catalog_item_id)?.cost_updated_at)}</span>}
              {!l.not_in_catalog && l.catalog_item_id && stock[l.catalog_item_id] && stock[l.catalog_item_id].type !== "service" && (
                <span className={Number(stock[l.catalog_item_id].all ?? 0) < Number(l.quantity) ? "font-medium text-amber-700" : ""}>
                  On hand: store {stock[l.catalog_item_id].store === null ? "—" : Number(stock[l.catalog_item_id].store).toLocaleString()} · all locations{" "}
                  {Number(stock[l.catalog_item_id].all ?? 0).toLocaleString()}
                  {Number(stock[l.catalog_item_id].all ?? 0) < Number(l.quantity) && " — not enough: after saving, open the quotation and ask Procurement for a supplier price"}
                </span>
              )}
              {l.not_in_catalog && <span className="font-medium text-amber-700">Not in catalog — flagged; priced by hand</span>}
              <label className="ml-auto flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={l.not_in_catalog}
                  onChange={(e) =>
                    setLines(
                      lines.map((x, j) =>
                        j === i ? { ...blankLine(), quantity: x.quantity, not_in_catalog: e.target.checked } : x,
                      ),
                    )
                  }
                />{" "}
                Not in catalog
              </label>
            </div>
            {lines.length > 1 && (
              <button type="button" className="text-xs text-red-600" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button-sm"
          onClick={() => setLines([...lines, blankLine()])}
        >
          Add line
        </button>
      </div>
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
          <span className="font-medium">Preview</span>
          <button type="button" className="text-xs underline" onClick={() => setShowPreview(!showPreview)}>{showPreview ? "Hide preview" : "Show preview"}</button>
        </div>
        {showPreview && (
          <div className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <div><span className="text-xs uppercase text-slate-500">Prepared for</span><div className="font-semibold">{custName || "— choose a customer —"}</div></div>
              <div className="text-right text-xs text-slate-500">QUOTATION · number assigned when saved<div>Payment: {terms || "As agreed"}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b-2 text-left text-xs uppercase text-slate-500"><th className="py-1">#</th><th className="py-1">Description</th><th className="py-1 text-right">Qty</th><th className="py-1">Unit</th><th className="py-1 text-right">Unit price</th><th className="py-1 text-right">Amount</th></tr></thead>
                <tbody>
                  {filled.length === 0 && <tr><td colSpan={6} className="py-3 text-center text-slate-500">No lines yet.</td></tr>}
                  {filled.map((l, n) => (
                    <tr key={n} className="border-b"><td className="py-1">{n + 1}</td><td className="py-1">{l.description}{l.not_in_catalog && <span className="ml-1 text-xs text-amber-700">(not in catalog)</span>}</td>
                      <td className="py-1 text-right">{Number(l.quantity).toLocaleString()}</td><td className="py-1">{l.unit}</td><td className="py-1 text-right">{money(l.unit_price)}</td><td className="py-1 text-right">{money(lineAmount(l))}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={5} className="pt-2 text-right">Subtotal</td><td className="pt-2 text-right">{money(subtotal)}</td></tr>
                  {discountAmount > 0 && <tr className={discountProblem ? "text-red-700" : ""}><td colSpan={5} className="text-right">Discount{discMode === "percent" ? ` (${discNum}%)` : ""}</td><td className="text-right">−{money(discountAmount)}</td></tr>}
                  {other > 0 && <tr><td colSpan={5} className="text-right">Other charges</td><td className="text-right">{money(other)}</td></tr>}
                  <tr><td colSpan={5} className="pt-1 text-right font-semibold">TOTAL</td><td className="pt-1 text-right font-semibold">{money(total)}</td></tr>
                  <tr><td colSpan={6} className="text-right text-xs text-slate-500">{vat ? `VAT-inclusive: VATable sales ${money(total - vatAmount)} · VAT 12% ${money(vatAmount)}` : "Prices are not subject to VAT."}</td></tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-slate-500">Catalog prices are confirmed by the pricing engine when the quotation is saved.</p>
          </div>
        )}
      </div>
      {formError && <p className="text-sm text-red-700">{formError}</p>}
      <button className="button" disabled={pending || !!discountProblem}>
        Save quotation
      </button>
    </Form>
  );
}
function Card({ title, children }: { title: string; children: any }) {
  return (
    <section className="rounded-xl border bg-white overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
function Field({ l, children }: { l: string; children: any }) {
  return (
    <div>
      <label className="label">{l}</label>
      {children}
    </div>
  );
}
function Badge({ s }: { s: string }) {
  return <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs capitalize">{String(s).replaceAll("_", " ")}</span>;
}
function Table({ headers, rows }: { headers: string[]; rows: any[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            {headers.map((h) => (
              <th key={h} className="p-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
