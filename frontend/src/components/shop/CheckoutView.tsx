"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { Button, Spinner } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order, PaymentMethods } from "@/types";

function Checkout() {
  const params = useSearchParams();
  const existingId = params.get("order");
  const { lines, subtotal, ready, clear } = useCart();
  const { user } = useAuth();
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  const [existing, setExisting] = useState<Order | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(!!existingId);
  const [busy, setBusy] = useState<"stripe" | "paypal" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => { api.get<ApiEnvelope<PaymentMethods>>("/payment-methods").then((r) => setMethods(r.data.data)).catch(() => setError("Could not load payment options.")); }, []);

  useEffect(() => {
    if (!existingId) return;
    api.get<ApiEnvelope<Order>>(`/orders/${existingId}`).then((r) => setExisting(r.data.data)).catch((e) => setError(parseError(e).message)).finally(() => setLoadingOrder(false));
  }, [existingId]);

  const items = existing ? existing.items.map((i) => ({ key: i.id, name: i.name, qty: i.quantity, total: Number(i.line_total) })) : lines.map((l) => ({ key: l.product_id, name: l.name, qty: l.quantity, total: l.price * l.quantity }));
  const total = existing ? Number(existing.total) : subtotal;
  const currency = existing?.currency ?? methods?.currency ?? "USD";

  async function pay(provider: "stripe" | "paypal") {
    setBusy(provider);
    setError("");
    try {
      let orderId = existing?.id;
      if (!orderId) {
        const { data } = await api.post<ApiEnvelope<Order>>("/orders", { items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })) });
        orderId = data.data.id;
      }
      const res = await api.post<ApiEnvelope<{ url?: string; approve_url?: string }>>(`/orders/${orderId}/pay/${provider}`);
      const dest = provider === "stripe" ? res.data.data.url : res.data.data.approve_url;
      if (!dest) throw new Error("no redirect");
      if (!existing) clear();
      window.location.assign(dest);
    } catch (err) {
      const info = parseError(err);
      const first = Object.values(info.fieldErrors)[0];
      setError(first ? `${info.message} ${first}` : info.message);
      setBusy(null);
    }
  }

  if (!ready || loadingOrder || !methods) return <Spinner label="Preparing checkout" />;
  if (items.length === 0) return <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-600">Nothing to check out. <Link href="/shop" className="text-indigo-600 underline">Browse products</Link></p>;
  if (existing && existing.status === "paid") return <p className="text-emerald-700">This order is already paid. <Link href={`/checkout/success?order=${existing.id}`} className="underline">View it</Link></p>;

  const none = !methods.stripe && !methods.paypal;
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Checkout</h1>
      <section aria-label="Order summary" className="rounded-xl border border-slate-200 bg-white p-5">
        <ul className="divide-y divide-slate-100 text-sm">
          {items.map((i) => <li key={i.key} className="flex justify-between py-2"><span>{i.name} × {i.qty}</span><span>{money(i.total, currency)}</span></li>)}
        </ul>
        <p className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg font-semibold"><span>Total</span><span>{money(total, currency)}</span></p>
        <p className="mt-1 text-xs text-slate-500">Prices are confirmed by our server when the order is placed.</p>
      </section>

      {user && !user.email_verified && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Please verify your email address before paying. Check your inbox for the link.</p>}
      {error && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {none && <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-700">No payment methods are available right now. Please try again later.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {methods.stripe && <Button loading={busy === "stripe"} disabled={busy !== null} onClick={() => pay("stripe")}>Pay by card (Stripe)</Button>}
        {methods.paypal && <Button variant="secondary" loading={busy === "paypal"} disabled={busy !== null} onClick={() => pay("paypal")}>Pay with PayPal</Button>}
      </div>
      <p className="text-xs text-slate-500">You will be redirected to the provider to complete payment securely. Card details never reach this site.</p>
    </div>
  );
}

export function CheckoutView() {
  return <RequireAuth><Checkout /></RequireAuth>;
}
