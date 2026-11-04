"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Category, Product, ProductImage, ProductStatus } from "@/types";

interface FormState {
  name: string; sku: string; price: string; stock: string; status: ProductStatus;
  category_id: string; short_description: string; description: string;
}

const EMPTY: FormState = { name: "", sku: "", price: "", stock: "0", status: "draft", category_id: "", short_description: "", description: "" };

function fromProduct(p: Product): FormState {
  return {
    name: p.name, sku: p.sku, price: String(p.price), stock: String(p.stock), status: p.status,
    category_id: p.category_id ? String(p.category_id) : "", short_description: p.short_description ?? "", description: p.description ?? "",
  };
}

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const { notify } = useToast();
  const [form, setForm] = useState<FormState>(product ? fromProduct(product) : EMPTY);
  const [images, setImages] = useState<ProductImage[]>(product?.images ?? []);
  const [pending, setPending] = useState<File[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [imgToDelete, setImgToDelete] = useState<ProductImage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api.get<ApiEnvelope<Category[]>>("/categories").then((r) => setCategories(r.data.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const d = previewRef.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    if (!preview && d.open) d.close();
  }, [preview]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Name is required.";
    if (!/^[A-Za-z0-9._-]+$/.test(form.sku)) e.sku = "SKU: letters, numbers, dot, dash, underscore only.";
    if (form.price === "" || Number(form.price) < 0 || Number.isNaN(Number(form.price))) e.price = "Enter a valid price.";
    if (!/^\d+$/.test(form.stock)) e.stock = "Stock must be a whole number.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function upload(productId: number, files: File[]) {
    const fd = new FormData();
    files.forEach((f) => fd.append("images[]", f));
    const { data } = await api.post<ApiEnvelope<ProductImage[]>>(`/admin/products/${productId}/images`, fd);
    setImages(data.data);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const body = { ...form, price: Number(form.price), stock: Number(form.stock), category_id: form.category_id ? Number(form.category_id) : null };
      const res = product
        ? await api.put<ApiEnvelope<Product>>(`/admin/products/${product.id}`, body)
        : await api.post<ApiEnvelope<Product>>("/admin/products", body);
      const saved = res.data.data;

      if (pending.length) {
        try { await upload(saved.id, pending); setPending([]); }
        catch (err) { notify("error", `Saved, but image upload failed: ${parseError(err).message}`); router.replace(`/admin/products/${saved.id}`); return; }
      }
      notify("success", product ? "Product updated." : "Product created.");
      router.push("/admin/products");
    } catch (err) {
      const info = parseError(err);
      if (Object.keys(info.fieldErrors).length) setErrors(info.fieldErrors);
      else notify("error", info.message);
    } finally {
      setSaving(false);
    }
  }

  function onFiles(list: FileList | null) {
    if (!list) return;
    const ok = Array.from(list).filter((f) => {
      const valid = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type) && f.size <= 5 * 1024 * 1024;
      if (!valid) notify("error", `${f.name}: must be JPG/PNG/WebP/GIF under 5 MB.`);
      return valid;
    });
    if (!ok.length) return;
    if (product) {
      setUploading(true);
      upload(product.id, ok).then(() => notify("success", "Images uploaded.")).catch((err) => notify("error", parseError(err).message)).finally(() => setUploading(false));
    } else {
      setPending((p) => [...p, ...ok].slice(0, 10));
    }
  }

  async function makePrimary(img: ProductImage) {
    if (!product) return;
    try {
      await api.patch(`/admin/products/${product.id}/images/${img.id}/primary`);
      setImages((l) => l.map((i) => ({ ...i, is_primary: i.id === img.id })));
    } catch (err) { notify("error", parseError(err).message); }
  }

  async function removeImage() {
    if (!product || !imgToDelete) return;
    try {
      await api.delete(`/admin/products/${product.id}/images/${imgToDelete.id}`);
      setImages((l) => { const rest = l.filter((i) => i.id !== imgToDelete.id); if (imgToDelete.is_primary && rest[0]) rest[0] = { ...rest[0], is_primary: true }; return rest; });
      setImgToDelete(null);
    } catch (err) { notify("error", parseError(err).message); }
  }

  const input = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  const previewImg = images.find((i) => i.is_primary)?.url ?? images[0]?.url;

  return (
    <form onSubmit={onSubmit} className="max-w-4xl space-y-6" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{product ? "Edit product" : "New product"}</h1>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setPreview(true)}>Preview</Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/admin/products")}>Cancel</Button>
          <Button type="submit" loading={saving}>{product ? "Save changes" : "Create product"}</Button>
        </div>
      </div>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name" value={form.name} onChange={(e) => set("name", e.target.value)} error={errors.name} maxLength={255} /></div>
        <Field label="SKU" value={form.sku} onChange={(e) => set("sku", e.target.value)} error={errors.sku} maxLength={100} />
        <Field label="Price (USD)" type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} error={errors.price} />
        <Field label="Stock" type="number" min="0" step="1" value={form.stock} onChange={(e) => set("stock", e.target.value)} error={errors.stock} />
        <div>
          <label htmlFor="category" className="mb-1 block text-sm font-medium text-slate-700">Category</label>
          <select id="category" className={input} value={form.category_id} onChange={(e) => set("category_id", e.target.value)}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {errors.category_id && <p className="mt-1 text-xs text-red-600">{errors.category_id}</p>}
        </div>
        <div>
          <label htmlFor="status" className="mb-1 block text-sm font-medium text-slate-700">Status</label>
          <select id="status" className={input} value={form.status} onChange={(e) => set("status", e.target.value as ProductStatus)}>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="short" className="mb-1 block text-sm font-medium text-slate-700">Short description</label>
          <textarea id="short" rows={2} maxLength={500} className={input} value={form.short_description} onChange={(e) => set("short_description", e.target.value)} />
          {errors.short_description && <p className="mt-1 text-xs text-red-600">{errors.short_description}</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-slate-700">Detailed description</h2>
        <RichTextEditor value={form.description} onChange={(html) => set("description", html)} />
        {errors.description && <p className="text-xs text-red-600">{errors.description}</p>}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">Images</h2>
          <Button type="button" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>Add images</Button>
          <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {images.length === 0 && pending.length === 0 && <p className="text-sm text-slate-500">No images yet. JPG, PNG, WebP or GIF, up to 5 MB each.</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {images.map((img) => (
            <li key={img.id} className="rounded-lg border border-slate-200 p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt={img.alt ?? ""} className="aspect-square w-full rounded object-cover" />
              <div className="mt-2 flex items-center justify-between">
                {img.is_primary ? <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-700">Primary</span> : <button type="button" className="text-indigo-600 hover:underline" onClick={() => makePrimary(img)}>Make primary</button>}
                <button type="button" className="text-red-600 hover:underline" onClick={() => setImgToDelete(img)}>Delete</button>
              </div>
            </li>
          ))}
          {pending.map((f, i) => (
            <li key={`${f.name}-${i}`} className="rounded-lg border border-dashed border-slate-300 p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt="" className="aspect-square w-full rounded object-cover" />
              <div className="mt-2 flex items-center justify-between">
                <span className="truncate text-slate-500">Uploads on save</span>
                <button type="button" className="text-red-600 hover:underline" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <dialog ref={previewRef} onClose={() => setPreview(false)} className="m-auto max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl p-0 backdrop:bg-black/40">
        <div className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Preview · {form.status}</span>
            <Button type="button" variant="secondary" onClick={() => setPreview(false)}>Close</Button>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {previewImg
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={previewImg} alt="" className="w-full rounded-lg object-cover" />
              : <div className="aspect-square rounded-lg bg-slate-100" />}
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">{form.name || "Untitled product"}</h2>
              <p className="mt-1 text-xs text-slate-500">SKU {form.sku || "—"}</p>
              <p className="mt-3 text-xl font-bold">${Number(form.price || 0).toFixed(2)}</p>
              <p className="mt-3 text-sm text-slate-600">{form.short_description}</p>
            </div>
          </div>
          {/* Sanitised server-side on save; preview shows the editor's own output. */}
          <div className="rich-content mt-6 border-t border-slate-200 pt-4" dangerouslySetInnerHTML={{ __html: form.description }} />
        </div>
      </dialog>

      <ConfirmDialog open={!!imgToDelete} danger title="Delete image?" message="This image will be permanently removed." confirmLabel="Delete" onConfirm={removeImage} onCancel={() => setImgToDelete(null)} />
    </form>
  );
}
