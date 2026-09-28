"use client";
import { errorText } from "@/core/errors/appError";
import { CatalogItemPicker } from "@/shared/catalog/CatalogItemPicker";
import { costAgeLabel } from "@/modules/finance/procurement/supplierQuoteAccess";
import { useState, useTransition } from "react";
import { useDialog } from "@/core/ui/Dialog";
import { ActionBar, PopupAction, usePopupClose } from "@/core/ui/PopupAction";
import {
  acceptQuotationAction,
  approveQuotationAction,
  approveSalesOrderAction,
  createCommissionAction,
  createDeliveryFromOrderAction,
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
} from "./revenueActions";
import { GoSignalForm, ORDERABLE, OrderView, QuoteView } from "./QuoteChain";
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
                <form
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
                </form>
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
            <PopupAction label="+ Create quotation" title="Create quotation" wide>
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
                <tr key={o.id} className="border-b">
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
                    {o.status === "approved" && (
                      <button
                        className="button-sm"
                        onClick={() => {
                          const l = locations[0]?.id;
                          if (!l) {
                            dialog.alert("Create a logistics warehouse/location first.", { tone: "danger" });
                            return;
                          }
                          dialog.prompt("Delivery number").then((n) => {
                            if (n) run(() => createDeliveryFromOrderAction(o.id, n, l));
                          });
                        }}
                      >
                        Send to warehouse
                      </button>
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
                <form
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
                </form>
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
  const [lines, setLines] = useState([{ catalog_item_id: "", description: "", quantity: 1, unit: "unit", unit_price: 0 }]);
  const [picked, setPicked] = useState<Record<string, any>>({});
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
    setLines(
      lines.map((l, j) =>
        j === i
          ? { ...l, catalog_item_id: item?.id || "", description: item?.item_name || "", unit: item?.unit || "unit", unit_price: item ? priceFor(item) : 0 }
          : l,
      ),
    );
  };
  return (
    <form
      action={(fd) => {
        fd.set("lines", JSON.stringify(lines));
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
          <select
            className="input"
            name="customer_id"
            value={customerId}
            onChange={(e) => {
              const cust = e.target.value;
              setCustomerId(cust);
              const terms = customers.find((x) => x.id === cust)?.payment_terms;
              if (terms) setTerms(terms);
              setLines(
                lines.map((l) => {
                  const item = l.catalog_item_id ? itemById(l.catalog_item_id) : null;
                  return item ? { ...l, unit_price: priceFor(item, cust) } : l;
                }),
              );
            }}
            required
          >
            <option value="">Select</option>
            {customers
              .filter((x) => x.active)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.customer_code} — {x.legal_name}
                </option>
              ))}
          </select>
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
        <Field l="Discount">
          <input className="input" name="discount_amount" type="number" step="0.01" defaultValue="0" />
        </Field>
        <Field l="Tax">
          <input className="input" name="tax_amount" type="number" step="0.01" defaultValue="0" />
        </Field>
        <Field l="Other charges">
          <input className="input" name="other_charges" type="number" step="0.01" defaultValue="0" />
        </Field>
        <Field l="Payment terms">
          <input className="input" name="payment_terms" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 30 days, COD" />
        </Field>
        <Field l="Delivery lead time">
          <input className="input" name="delivery_lead_time" placeholder="e.g. within the day, 3-5 days" />
        </Field>
      </div>
      <div className="border rounded-lg p-3 space-y-2">
        <div className="font-medium">
          Line items <span className="text-xs text-slate-500">Catalog items use the central pricing engine; custom items remain manually priced.</span>
        </div>
        {lines.map((l, i) => (
          <div className="grid md:grid-cols-12 gap-2" key={i}>
            <CatalogItemPicker className="md:col-span-4" value={l.catalog_item_id} allowCustom onSelect={(item) => choose(i, item)} />
            <input
              className="input md:col-span-3"
              placeholder="Description"
              value={l.description}
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
              readOnly={!!l.catalog_item_id}
              onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: Number(e.target.value) } : x)))}
            />
            {l.catalog_item_id && itemById(l.catalog_item_id) && (
              <div className="md:col-span-12 -mt-1 text-xs text-slate-500">{costAgeLabel(itemById(l.catalog_item_id)?.cost_updated_at)}</div>
            )}
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
          onClick={() => setLines([...lines, { catalog_item_id: "", description: "", quantity: 1, unit: "unit", unit_price: 0 }])}
        >
          Add line
        </button>
      </div>
      <button className="button" disabled={pending}>
        Save quotation
      </button>
    </form>
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
