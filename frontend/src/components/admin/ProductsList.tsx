"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Category, PageMeta, Product } from "@/types";

const STATUS_STYLE: Record<string, string> = {
  published: "bg-emerald-100 text-emerald-800",
  draft: "bg-slate-100 text-slate-700",
  archived: "bg-amber-100 text-amber-800",
};

const COLUMNS: { key: string; label: string; sortable?: boolean }[] = [
  { key: "name", label: "Product", sortable: true },
  { key: "sku", label: "SKU", sortable: true },
  { key: "price", label: "Price", sortable: true },
  { key: "stock", label: "Stock", sortable: true },
  { key: "status", label: "Status", sortable: true },
];

export function ProductsList() {
  const { notify } = useToast();
  const router = useRouter();
  const [items, setItems] = useState<Product[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState("id");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toDelete, setToDelete] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [exportScope, setExportScope] = useState<"selected" | "all" | null>(null);
  const [exporting, setExporting] = useState(false);

  // Reset to page 1 only when the text really changed; otherwise the mount-time timer would undo a quick page change.
  const applied = useRef("");
  useEffect(() => {
    const t = setTimeout(() => { if (applied.current !== searchInput) { applied.current = searchInput; setSearch(searchInput); setPage(1); } }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get<ApiEnvelope<Category[]>>("/categories").then((r) => setCategories(r.data.data)).catch(() => {});
  }, []);

  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get<ApiEnvelope<{ items: Product[]; meta: PageMeta }>>("/admin/products", {
        params: { search: search || undefined, status: status || undefined, category_id: categoryId || undefined, sort, direction, page, per_page: 15 },
      });
      if (id !== reqId.current) return; // a newer request superseded this one
      setItems(data.data.items);
      setMeta(data.data.meta);
    } catch (err) {
      if (id === reqId.current) setError(parseError(err).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [search, status, categoryId, sort, direction, page]);

  useEffect(() => { Promise.resolve().then(load); }, [load]);

  function toggleSort(key: string) {
    if (sort === key) setDirection(direction === "asc" ? "desc" : "asc");
    else { setSort(key); setDirection("asc"); }
    setPage(1);
  }

  const allOnPage = items.length > 0 && items.every((p) => selected.has(p.id));
  function toggleAll() {
    const next = new Set(selected);
    if (allOnPage) items.forEach((p) => next.delete(p.id));
    else items.forEach((p) => next.add(p.id));
    setSelected(next);
  }
  function toggleOne(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/products/${toDelete.id}`);
      notify("success", `Deleted “${toDelete.name}”.`);
      setSelected((s) => { const n = new Set(s); n.delete(toDelete.id); return n; });
      setToDelete(null);
      load();
    } catch (err) {
      notify("error", parseError(err).message);
    } finally {
      setDeleting(false);
    }
  }

  async function startExport() {
    if (!exportScope) return;
    setExporting(true);
    try {
      await api.post("/admin/pdf-exports", exportScope === "all" ? { scope: "all" } : { scope: "selected", product_ids: [...selected] });
      notify("success", "Export started. It will appear on the PDF exports page.");
      setExportScope(null);
      router.push("/admin/exports");
    } catch (err) {
      notify("error", parseError(err).message);
      setExportScope(null);
    } finally {
      setExporting(false);
    }
  }

  const select = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Products</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={selected.size === 0} onClick={() => setExportScope("selected")}>Export selected{selected.size ? ` (${selected.size})` : ""} to PDF</Button>
          <Button variant="secondary" disabled={!meta || meta.total === 0} onClick={() => setExportScope("all")}>Export all to PDF</Button>
          <Link href="/admin/products/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Add product</Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input type="search" aria-label="Search products" placeholder="Search name or SKU…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className={`${select} w-64`} />
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={select}>
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <select aria-label="Filter by category" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} className={select}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selected.size > 0 && <span className="self-center text-sm text-slate-600">{selected.size} selected <button className="ml-2 text-indigo-600 hover:underline" onClick={() => setSelected(new Set())}>Clear</button></span>}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="w-10 p-3"><input type="checkbox" aria-label="Select all on page" checked={allOnPage} onChange={toggleAll} /></th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="p-3 font-medium" aria-sort={sort === c.key ? (direction === "asc" ? "ascending" : "descending") : undefined}>
                  <button onClick={() => toggleSort(c.key)} className="inline-flex items-center gap-1 hover:text-slate-900">
                    {c.label}{sort === c.key && <span aria-hidden>{direction === "asc" ? "▲" : "▼"}</span>}
                  </button>
                </th>
              ))}
              <th className="p-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7}><Spinner label="Loading products" /></td></tr>
            ) : error ? (
              <tr><td colSpan={7} className="p-8 text-center text-red-700">{error} <button className="underline" onClick={load}>Retry</button></td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="p-10 text-center text-slate-500">No products found. <Link href="/admin/products/new" className="text-indigo-600 underline">Add your first product</Link>.</td></tr>
            ) : items.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="p-3"><input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} onChange={() => toggleOne(p.id)} /></td>
                <td className="p-3">
                  <div className="flex items-center gap-3">
                    {p.primary_image
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.primary_image} alt="" className="h-10 w-10 rounded object-cover" />
                      : <div className="h-10 w-10 rounded bg-slate-100" aria-hidden />}
                    <div>
                      <div className="font-medium text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.category?.name ?? "Uncategorised"}</div>
                    </div>
                  </div>
                </td>
                <td className="p-3 font-mono text-xs">{p.sku}</td>
                <td className="p-3">${Number(p.price).toFixed(2)}</td>
                <td className="p-3">{p.stock}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{p.status}</span></td>
                <td className="p-3 text-right">
                  <Link href={`/admin/products/${p.id}`} className="mr-3 text-indigo-600 hover:underline">Edit</Link>
                  <button className="text-red-600 hover:underline" onClick={() => setToDelete(p)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>Page {meta.current_page} of {meta.last_page} · {meta.total} products</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={exportScope !== null}
        busy={exporting}
        title="Export to PDF?"
        message={exportScope === "all" ? "Every product, with images and full descriptions, will be exported. Large catalogs can take several minutes and run in the background." : `${selected.size} selected product(s) will be exported in the background.`}
        confirmLabel="Start export"
        onConfirm={startExport}
        onCancel={() => setExportScope(null)}
      />
      <ConfirmDialog open={!!toDelete} danger busy={deleting} title="Delete product?" message={`“${toDelete?.name}” and its images will be permanently removed.`} confirmLabel="Delete" onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
