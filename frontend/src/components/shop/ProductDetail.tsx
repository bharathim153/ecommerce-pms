"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useCart } from "@/context/CartContext";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Product } from "@/types";

export function ProductDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { add } = useCart();
  const { notify } = useToast();
  const [p, setP] = useState<Product | null>(null);
  const [error, setError] = useState("");
  const [qty, setQty] = useState(1);
  const [active, setActive] = useState(0);

  useEffect(() => {
    api.get<ApiEnvelope<Product>>(`/products/${slug}`).then((r) => setP(r.data.data))
      .catch((e) => setError(parseError(e).status === 404 ? "This product is not available." : parseError(e).message));
  }, [slug]);

  if (error) return <p className="text-red-700">{error} <Link href="/shop" className="underline">Back to shop</Link></p>;
  if (!p) return <Spinner label="Loading product" />;

  const imgs = p.images ?? [];
  const main = imgs[active]?.url ?? p.primary_image;

  return (
    <div className="space-y-8">
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          {main
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={main} alt={p.name} className="w-full rounded-xl border border-slate-200 bg-white object-contain" />
            : <div className="aspect-square rounded-xl bg-slate-100" />}
          {imgs.length > 1 && (
            <ul className="mt-3 flex gap-2">
              {imgs.map((i, n) => (
                <li key={i.id}><button onClick={() => setActive(n)} aria-label={`Image ${n + 1}`} className={`rounded border-2 ${n === active ? "border-indigo-600" : "border-transparent"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={i.url} alt="" className="h-16 w-16 rounded object-cover" /></button></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-sm text-slate-500">{p.category?.name}</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">{p.name}</h1>
          <p className="mt-1 text-xs text-slate-500">SKU {p.sku}</p>
          <p className="mt-4 text-2xl font-bold text-indigo-700">{money(p.price)}</p>
          {p.short_description && <p className="mt-4 text-slate-700">{p.short_description}</p>}
          <p className={`mt-4 text-sm ${p.stock > 0 ? "text-emerald-700" : "text-red-600"}`}>{p.stock > 0 ? `${p.stock} in stock` : "Out of stock"}</p>
          {p.stock > 0 && (
            <div className="mt-4 flex items-end gap-3">
              <div>
                <label htmlFor="qty" className="mb-1 block text-sm font-medium text-slate-700">Quantity</label>
                <input id="qty" type="number" min={1} max={Math.min(p.stock, 100)} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(Number(e.target.value) || 1, p.stock, 100)))} className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm" />
              </div>
              <Button onClick={() => { add({ product_id: p.id, slug: p.slug, name: p.name, price: Number(p.price), image: p.primary_image, stock: p.stock }, qty); notify("success", "Added to cart."); }}>Add to cart</Button>
            </div>
          )}
        </div>
      </div>
      {p.description && (
        <section aria-label="Description" className="rounded-xl border border-slate-200 bg-white p-6">
          {/* Sanitised by the server (HTMLPurifier whitelist) before it was stored. */}
          <div className="rich-content" dangerouslySetInnerHTML={{ __html: p.description }} />
        </section>
      )}
    </div>
  );
}
