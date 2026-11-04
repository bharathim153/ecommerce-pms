"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order } from "@/types";

/** Never believes the redirect: it asks our server, which asks the gateway. Polls briefly for the webhook. */
function Success() {
  const params = useSearchParams();
  const id = params.get("order");
  const provider = params.get("provider");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [gaveUp, setGaveUp] = useState(false);
  const tries = useRef(0);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const url = provider === "stripe" ? `/orders/${id}/stripe/confirm` : `/orders/${id}`;
        const { data } = provider === "stripe" ? await api.post<ApiEnvelope<Order>>(url) : await api.get<ApiEnvelope<Order>>(url);
        if (!alive) return;
        setOrder(data.data);
        if (data.data.status === "pending" && ++tries.current < 10) timer = setTimeout(check, 2000);
        else if (data.data.status === "pending") setGaveUp(true);
      } catch (e) { if (alive) setError(parseError(e).message); }
    };
    Promise.resolve().then(check);
    return () => { alive = false; clearTimeout(timer); };
  }, [id, provider]);

  if (!id) return <p className="text-red-700">Missing order.</p>;
  if (error) return <p className="text-red-700">{error}</p>;
  if (!order) return <Spinner label="Confirming your payment" />;

  if (order.status === "paid") {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-emerald-200 bg-white p-8 text-center">
        <div className="text-4xl" aria-hidden>✓</div>
        <h1 className="text-2xl font-semibold text-emerald-700">Payment successful</h1>
        <p className="text-slate-600">Order <strong>{order.number}</strong> · {money(order.total, order.currency)}</p>
        <ul className="mx-auto max-w-sm divide-y divide-slate-100 text-left text-sm">{order.items.map((i) => <li key={i.id} className="flex justify-between py-1.5"><span>{i.name} × {i.quantity}</span><span>{money(i.line_total, order.currency)}</span></li>)}</ul>
        <Link href="/shop" className="inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Continue shopping</Link>
      </div>
    );
  }
  if (order.status === "pending") {
    return (
      <div className="mx-auto max-w-xl space-y-3 rounded-xl border border-slate-200 bg-white p-8 text-center">
        {gaveUp ? (<><h1 className="text-xl font-semibold">We haven&apos;t received confirmation yet</h1><p className="text-slate-600">If you completed payment, this page will update once the provider confirms it. Order {order.number}.</p></>) : (<Spinner label="Waiting for payment confirmation" />)}
      </div>
    );
  }
  return <p className="text-red-700">This order is {order.status}. <Link href={`/checkout?order=${order.id}`} className="underline">Try again</Link></p>;
}

export function SuccessView() { return <RequireAuth><Success /></RequireAuth>; }

export function FailureView() {
  const params = useSearchParams();
  const id = params.get("order");
  return (
    <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-red-200 bg-white p-8 text-center">
      <div className="text-4xl" aria-hidden>✕</div>
      <h1 className="text-2xl font-semibold text-red-700">Payment not completed</h1>
      <p className="text-slate-600">You were not charged, or the payment was cancelled. Your items are still reserved in your order.</p>
      <div className="flex justify-center gap-3">
        {id && <Link href={`/checkout?order=${id}`} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Try again</Link>}
        <Link href="/cart" className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800">Back to cart</Link>
      </div>
    </div>
  );
}

function PayPalReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const orderId = params.get("order");
  const paypalOrder = params.get("token");
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (!orderId || !paypalOrder || started.current) return;
    started.current = true; // StrictMode / refresh safe: the server is idempotent anyway
    api.post(`/orders/${orderId}/paypal/capture`, { paypal_order_id: paypalOrder })
      .then(() => router.replace(`/checkout/success?order=${orderId}&provider=paypal`))
      .catch((e) => { const i = parseError(e); setError(i.message); if (i.status === 402) router.replace(`/checkout/failure?order=${orderId}&provider=paypal`); });
  }, [orderId, paypalOrder, router]);

  if (!orderId || !paypalOrder) return <p className="text-red-700">Invalid PayPal return link.</p>;
  if (error) return <p role="alert" className="text-red-700">{error}</p>;
  return <Spinner label="Finalising your PayPal payment" />;
}

export function PayPalReturnView() { return <RequireAuth><PayPalReturn /></RequireAuth>; }
