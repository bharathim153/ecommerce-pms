"use client";

import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order, PageMeta } from "@/types";

const BADGE: Record<string, string> = { paid: "bg-emerald-100 text-emerald-800", pending: "bg-slate-100 text-slate-700", failed: "bg-red-100 text-red-800", refunded: "bg-amber-100 text-amber-800", cancelled: "bg-slate-100 text-slate-500" };

export function OrdersList() {
  const [items, setItems] = useState<Order[]>([]);
  const [meta, setMeta] = useState<Pick<PageMeta, "current_page" | "last_page" | "total"> | null>(null);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const { data } = await api.get<ApiEnvelope<{ items: Order[]; meta: Pick<PageMeta, "current_page" | "last_page" | "total"> }>>("/admin/orders", { params: { status: status || undefined, page } });
        if (live) { setItems(data.data.items); setMeta(data.data.meta); setError(""); }
      } catch (e) { if (live) setError(parseError(e).message); } finally { if (live) setLoading(false); }
    });
    return () => { live = false; };
  }, [status, page]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Orders</h1>
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">All statuses</option>{["pending", "paid", "failed", "refunded"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3 font-medium">Order</th><th className="p-3 font-medium">Customer</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Total</th><th className="p-3 font-medium">Placed</th><th className="p-3" /></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6}><Spinner label="Loading orders" /></td></tr>
              : error ? <tr><td colSpan={6} className="p-8 text-center text-red-700">{error}</td></tr>
              : items.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-slate-500">No orders yet.</td></tr>
              : items.flatMap((o) => [
                <tr key={o.id} className="border-b border-slate-100">
                  <td className="p-3 font-mono text-xs">{o.number}</td>
                  <td className="p-3">{o.customer?.name}<div className="text-xs text-slate-500">{o.customer?.email}</div></td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[o.status]}`}>{o.status}</span></td>
                  <td className="p-3">{money(o.total, o.currency)}</td>
                  <td className="p-3 text-slate-600">{new Date(o.created_at).toLocaleString()}</td>
                  <td className="p-3 text-right"><button className="text-indigo-600 hover:underline" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? "Hide" : "Details"}</button></td>
                </tr>,
                open === o.id && (
                  <tr key={`${o.id}-d`} className="border-b border-slate-100 bg-slate-50"><td colSpan={6} className="p-4 text-sm">
                    <ul className="mb-2">{o.items.map((i) => <li key={i.id}>{i.name} <span className="text-slate-500">({i.sku})</span> × {i.quantity} — {money(i.line_total, o.currency)}</li>)}</ul>
                    <p className="text-slate-600">Payments: {o.payments.length ? o.payments.map((p) => `${p.provider} ${p.status}`).join(", ") : "none"}{o.paid_at && ` · paid ${new Date(o.paid_at).toLocaleString()}`}</p>
                  </td></tr>
                ),
              ])}
          </tbody>
        </table>
      </div>
      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600"><span>Page {meta.current_page} of {meta.last_page} · {meta.total} orders</span>
          <div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      )}
    </div>
  );
}
