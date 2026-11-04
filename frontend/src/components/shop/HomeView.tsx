"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Category, Product } from "@/types";

export function HomeView() {
  const [items, setItems] = useState<Product[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.get<ApiEnvelope<{ items: Product[] }>>("/products", { params: { per_page: 8 } }).then((r) => setItems(r.data.data.items)).catch(() => { setFailed(true); setItems([]); });
    api.get<ApiEnvelope<Category[]>>("/categories").then((r) => setCats(r.data.data.filter((c) => (c.products_count ?? 0) > 0))).catch(() => {});
  }, []);

  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 px-6 py-14 text-center text-white sm:px-12">
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">Quality products, simple checkout</h1>
        <p className="mx-auto mt-4 max-w-xl text-indigo-100">Browse the catalog, pay securely by card or PayPal, and track every order from your account.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/shop" className="rounded-md bg-white px-5 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">Shop now</Link>
          <Link href="/register" className="rounded-md border border-white/60 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10">Create account</Link>
        </div>
      </section>

      {cats.length > 0 && (
        <section aria-label="Categories">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Shop by category</h2>
          <ul className="flex flex-wrap gap-2">
            {cats.map((c) => <li key={c.id}><Link href={`/shop?category=${c.slug}`} className="inline-block rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700">{c.name} <span className="text-slate-400">{c.products_count}</span></Link></li>)}
          </ul>
        </section>
      )}

      <section aria-label="New arrivals">
        <div className="mb-3 flex items-end justify-between"><h2 className="text-lg font-semibold text-slate-900">New arrivals</h2><Link href="/shop" className="text-sm text-indigo-600 hover:underline">View all</Link></div>
        {items === null ? <Spinner label="Loading products" /> : failed ? <p className="text-red-700">We couldn&apos;t load products right now. Please try again shortly.</p> : items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">New products are coming soon.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {items.map((p) => (
              <li key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Link href={`/shop/${p.slug}`} className="block">
                  {p.primary_image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.primary_image} alt="" className="aspect-square w-full object-cover" />
                    : <div className="aspect-square bg-slate-100" aria-hidden />}
                  <div className="p-3"><h3 className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</h3><p className="mt-1 font-semibold text-indigo-700">{money(p.price)}</p></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
