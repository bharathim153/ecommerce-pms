"use client";

import Link from "next/link";
import { Button, Spinner } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { money } from "@/lib/format";

export function CartView() {
  const { lines, subtotal, ready, setQty, remove, clear } = useCart();
  if (!ready) return <Spinner label="Loading cart" />;
  if (lines.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-12 text-center">
        <p className="text-slate-600">Your cart is empty.</p>
        <Link href="/shop" className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Browse products</Link>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Your cart</h1>
      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {lines.map((l) => (
          <li key={l.product_id} className="flex flex-wrap items-center gap-4 p-4">
            {l.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={l.image} alt="" className="h-16 w-16 rounded object-cover" />
              : <div className="h-16 w-16 rounded bg-slate-100" aria-hidden />}
            <div className="min-w-0 flex-1">
              <Link href={`/shop/${l.slug}`} className="font-medium text-slate-900 hover:underline">{l.name}</Link>
              <p className="text-sm text-slate-500">{money(l.price)} each</p>
            </div>
            <label className="text-sm text-slate-600">Qty
              <input type="number" min={1} max={Math.min(l.stock, 100)} value={l.quantity} onChange={(e) => setQty(l.product_id, Number(e.target.value) || 1)} className="ml-2 w-20 rounded-md border border-slate-300 px-2 py-1" />
            </label>
            <span className="w-24 text-right font-medium">{money(l.price * l.quantity)}</span>
            <button className="text-sm text-red-600 hover:underline" onClick={() => remove(l.product_id)}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
        <span className="text-lg font-semibold">Subtotal {money(subtotal)}</span>
        <Link href="/checkout" className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700">Checkout</Link>
      </div>
      <Button variant="ghost" onClick={clear}>Clear cart</Button>
    </div>
  );
}
