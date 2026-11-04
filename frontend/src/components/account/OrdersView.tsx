"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order, PageMeta } from "@/types";

const BADGE: Record<string, string> = { paid: "bg-emerald-100 text-emerald-800", pending: "bg-slate-100 text-slate-700", failed: "bg-red-100 text-red-800", refunded: "bg-amber-100 text-amber-800", cancelled: "bg-slate-100 text-slate-500" };
const Status = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[s]}`}>{s}</span>;

export function OrdersView() {
  const [items, setItems] = useState<Order[]>([]);
  const [meta, setMeta] = useState<Pick<PageMeta, "current_page" | "last_page" | "total"> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const { data } = await api.get<ApiEnvelope<{ items: Order[]; meta: Pick<PageMeta, "current_page" | "last_page" | "total"> }>>("/orders", { params: { page } });
        if (live) { setItems(data.data.items); setMeta(data.data.meta); setError(""); }
      } catch (e) { if (live) setError(parseError(e).message); } finally { if (live) setLoading(false); }
    });
    return () => { live = false; };
  }, [page]);

  if (loading) return <Spinner label="Loading orders" />;
  if (error) return <p className="text-red-700">{error}</p>;
  if (items.length === 0) return <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center"><p className="text-slate-600">You haven&apos;t placed any orders yet.</p><Link href="/shop" className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Start shopping</Link></div>;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {items.map((o) => (
          <li key={o.id}>
            <Link href={`/account/orders/${o.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-slate-50">
              <div><p className="font-mono text-sm font-medium text-slate-900">{o.number}</p><p className="text-xs text-slate-500">{new Date(o.created_at).toLocaleDateString()} · {o.items.reduce((n, i) => n + i.quantity, 0)} item(s)</p></div>
              <div className="flex items-center gap-4"><Status s={o.status} /><span className="font-semibold text-slate-900">{money(o.total, o.currency)}</span></div>
            </Link>
          </li>
        ))}
      </ul>
      {meta && meta.last_page > 1 && <div className="flex items-center justify-between text-sm text-slate-600"><span>Page {meta.current_page} of {meta.last_page}</span><div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>Next</Button></div></div>}
    </div>
  );
}

export function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [o, setO] = useState<Order | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.get<ApiEnvelope<Order>>(`/orders/${id}`).then((r) => setO(r.data.data)).catch((e) => setError(parseError(e).status === 404 ? "Order not found." : parseError(e).message)); }, [id]);

  if (error) return <p className="text-red-700">{error} <Link href="/account/orders" className="underline">Back to orders</Link></p>;
  if (!o) return <Spinner label="Loading order" />;
  return (
    <div className="space-y-4">
      <Link href="/account/orders" className="text-sm text-indigo-600 hover:underline">← All orders</Link>
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6" aria-label={`Order ${o.number}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-mono text-lg font-semibold text-slate-900">{o.number}</h2><Status s={o.status} /></div>
        <p className="text-sm text-slate-500">Placed {new Date(o.created_at).toLocaleString()}{o.paid_at && ` · Paid ${new Date(o.paid_at).toLocaleString()}`}</p>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="py-2 font-medium">Item</th><th className="py-2 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">Price</th><th className="py-2 text-right font-medium">Total</th></tr></thead>
          <tbody>{o.items.map((i) => <tr key={i.id} className="border-t border-slate-100"><td className="py-2">{i.name}<div className="text-xs text-slate-500">{i.sku}</div></td><td className="py-2 text-right tabular-nums">{i.quantity}</td><td className="py-2 text-right tabular-nums">{money(i.unit_price, o.currency)}</td><td className="py-2 text-right tabular-nums">{money(i.line_total, o.currency)}</td></tr>)}</tbody></table>
        <p className="flex justify-between border-t border-slate-200 pt-3 text-lg font-semibold"><span>Total</span><span>{money(o.total, o.currency)}</span></p>
        {(o.status === "pending" || o.status === "failed") && <Link href={`/checkout?order=${o.id}`} className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Complete payment</Link>}
      </section>
    </div>
  );
}
