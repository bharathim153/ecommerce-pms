"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { Category, PageMeta, Product } from "@/types";

export function ProductGrid() {
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { api.get<ApiEnvelope<Category[]>>("/categories").then((r) => setCats(r.data.data)).catch(() => {}); }, []);
  // Reset to page 1 only when the text really changed (see admin ProductsList).
  const applied = useRef("");
  useEffect(() => { const t = setTimeout(() => { if (applied.current !== search) { applied.current = search; setQ(search); setPage(1); } }, 350); return () => clearTimeout(t); }, [search]);

  useEffect(() => {
    let live = true;
    Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const { data } = await api.get<ApiEnvelope<{ items: Product[]; meta: PageMeta }>>("/products", { params: { search: q || undefined, category: category || undefined, sort: sort || undefined, page, per_page: 12 } });
        if (!live) return;
        setItems(data.data.items); setMeta(data.data.meta); setError("");
      } catch (err) { if (live) setError(parseError(err).message); }
      finally { if (live) setLoading(false); }
    });
    return () => { live = false; };
  }, [q, category, sort, page]);

  const sel = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Shop</h1>
      <div className="flex flex-wrap gap-2">
        <input type="search" aria-label="Search products" placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${sel} w-64`} />
        <select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className={sel}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className={sel}>
          <option value="">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="name">Name</option>
        </select>
      </div>
      {loading ? <Spinner label="Loading products" /> : error ? <p className="text-red-700">{error}</p> : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No products found.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Link href={`/shop/${p.slug}`} className="block">
                {p.primary_image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.primary_image} alt="" className="aspect-square w-full object-cover" />
                  : <div className="aspect-square bg-slate-100" aria-hidden />}
                <div className="p-3">
                  <h2 className="line-clamp-2 text-sm font-medium text-slate-900">{p.name}</h2>
                  <p className="mt-1 font-semibold text-indigo-700">{money(p.price)}</p>
                  {p.stock === 0 && <p className="text-xs text-red-600">Out of stock</p>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {meta.current_page} of {meta.last_page}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
