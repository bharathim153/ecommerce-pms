"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, Field, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { PageMeta, Subscriber } from "@/types";

interface Stats { subscribed: number; unsubscribed: number; bounced: number }

function badge(s: Subscriber) {
  if (s.bounced_at) return ["bounced", "bg-amber-100 text-amber-800"];
  return s.is_subscribed ? ["subscribed", "bg-emerald-100 text-emerald-800"] : ["unsubscribed", "bg-slate-100 text-slate-600"];
}

export function SubscribersList() {
  const { notify } = useToast();
  const [items, setItems] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [meta, setMeta] = useState<Pick<PageMeta, "current_page" | "last_page" | "total"> | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", consent: false });
  const [formErr, setFormErr] = useState<Record<string, string>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importConsent, setImportConsent] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [toRemove, setToRemove] = useState<Subscriber | null>(null);
  const [toUnsub, setToUnsub] = useState<Subscriber | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset to page 1 only when the text really changed (see ProductsList).
  const applied = useRef("");
  useEffect(() => { const t = setTimeout(() => { if (applied.current !== searchInput) { applied.current = searchInput; setSearch(searchInput); setPage(1); } }, 350); return () => clearTimeout(t); }, [searchInput]);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ApiEnvelope<{ items: Subscriber[]; stats: Stats; meta: Pick<PageMeta, "current_page" | "last_page" | "total"> }>>("/admin/email/subscribers", { params: { search: search || undefined, status: status || undefined, page } });
      setItems(data.data.items); setStats(data.data.stats); setMeta(data.data.meta); setError("");
    } catch (e) { setError(parseError(e).message); } finally { setLoading(false); }
  }, [search, status, page]);
  useEffect(() => { Promise.resolve().then(load); }, [load, tick]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setFormErr({});
    setAdding(true);
    try {
      await api.post("/admin/email/subscribers", { email: form.email, name: form.name || null, consent_confirmed: form.consent });
      notify("success", "Subscriber added.");
      setForm({ email: "", name: "", consent: false }); setTick((t) => t + 1);
    } catch (err) {
      const i = parseError(err);
      setFormErr(Object.keys(i.fieldErrors).length ? i.fieldErrors : { email: i.message });
    } finally { setAdding(false); }
  }

  async function doImport() {
    const f = fileRef.current?.files?.[0];
    if (!f) return setImportMsg("Choose a CSV file first.");
    setImporting(true); setImportMsg("");
    const fd = new FormData();
    fd.append("file", f); fd.append("consent_confirmed", importConsent ? "1" : "");
    try {
      const { data } = await api.post<ApiEnvelope<Record<string, number>>>("/admin/email/subscribers/import", fd);
      const d = data.data;
      setImportMsg(`Added ${d.added}. Skipped: ${d.already_exists} already in list, ${d.invalid} invalid, ${d.duplicate_in_file} duplicate rows.`);
      setTick((t) => t + 1);
    } catch (err) {
      const i = parseError(err);
      setImportMsg(Object.values(i.fieldErrors)[0] ?? i.message);
    } finally { setImporting(false); }
  }

  async function exportCsv() {
    try {
      const res = await api.get("/admin/email/subscribers/export", { params: { status: status || undefined }, responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a"); a.href = url; a.download = "subscribers.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { notify("error", parseError(e).message); }
  }

  async function unsubscribe() {
    if (!toUnsub) return;
    try { await api.patch(`/admin/email/subscribers/${toUnsub.id}`, { is_subscribed: false }); notify("success", "Unsubscribed."); } catch (e) { notify("error", parseError(e).message); }
    setToUnsub(null); setTick((t) => t + 1);
  }
  async function remove() {
    if (!toRemove) return;
    try { await api.delete(`/admin/email/subscribers/${toRemove.id}`); notify("success", "Subscriber deleted."); } catch (e) { notify("error", parseError(e).message); }
    setToRemove(null); setTick((t) => t + 1);
  }

  const sel = "rounded-md border border-slate-300 bg-white px-3 py-2 text-sm";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Subscribers</h1>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => { setImportOpen(!importOpen); setImportMsg(""); }}>Import CSV</Button><Button variant="secondary" onClick={exportCsv}>Export CSV</Button></div>
      </div>

      {stats && (
        <dl className="grid grid-cols-3 gap-3">
          {([["Subscribed", stats.subscribed, "text-emerald-700"], ["Unsubscribed", stats.unsubscribed, "text-slate-700"], ["Bounced", stats.bounced, "text-amber-700"]] as const).map(([l, v, c]) => (
            <div key={l} className="rounded-xl border border-slate-200 bg-white p-4"><dt className="text-xs text-slate-500">{l}</dt><dd className={`text-2xl font-semibold ${c}`}>{v}</dd></div>
          ))}
        </dl>
      )}

      {importOpen && (
        <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5" aria-label="Import subscribers">
          <p className="text-sm text-slate-600">CSV with <code>email</code> in the first column and an optional <code>name</code> in the second. People already in the list (including anyone who unsubscribed) are never changed.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" aria-label="CSV file" className="block text-sm" />
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={importConsent} onChange={(e) => setImportConsent(e.target.checked)} className="mt-1" /> I confirm everyone in this file agreed to receive marketing email from us.</label>
          <div className="flex items-center gap-3"><Button onClick={doImport} loading={importing} disabled={!importConsent}>Import</Button>{importMsg && <p role="status" className="text-sm text-slate-700">{importMsg}</p>}</div>
        </section>
      )}

      <form onSubmit={add} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-[1fr_1fr_auto]" aria-label="Add subscriber" noValidate>
        <Field label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={formErr.email} />
        <Field label="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="flex items-end"><Button type="submit" loading={adding} disabled={!form.email || !form.consent}>Add</Button></div>
        <label className="flex items-start gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} className="mt-1" /> This person agreed to receive marketing email.{formErr.consent_confirmed && <span className="text-red-600"> {formErr.consent_confirmed}</span>}</label>
      </form>

      <div className="flex flex-wrap gap-2">
        <input type="search" aria-label="Search subscribers" placeholder="Search email or name…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className={`${sel} w-64`} />
        <select aria-label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={sel}>
          <option value="">All</option><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3 font-medium">Email</th><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Source</th><th className="p-3" /></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}><Spinner label="Loading subscribers" /></td></tr>
              : error ? <tr><td colSpan={5} className="p-8 text-center text-red-700">{error}</td></tr>
              : items.length === 0 ? <tr><td colSpan={5} className="p-10 text-center text-slate-500">No subscribers found.</td></tr>
              : items.map((s) => { const [label, cls] = badge(s); return (
                <tr key={s.id} className="border-b border-slate-100 last:border-0">
                  <td className="p-3">{s.email}</td><td className="p-3 text-slate-600">{s.name}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span></td>
                  <td className="p-3 text-slate-500">{s.source}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {s.is_subscribed && !s.bounced_at && <button className="mr-3 text-slate-600 hover:underline" onClick={() => setToUnsub(s)}>Unsubscribe</button>}
                    <button className="text-red-600 hover:underline" onClick={() => setToRemove(s)}>Delete</button>
                  </td>
                </tr>); })}
          </tbody>
        </table>
      </div>
      {meta && meta.last_page > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600"><span>Page {meta.current_page} of {meta.last_page} · {meta.total} subscribers</span>
          <div className="flex gap-2"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="secondary" disabled={page >= meta.last_page} onClick={() => setPage(page + 1)}>Next</Button></div></div>
      )}
      <ConfirmDialog open={!!toUnsub} title="Unsubscribe this person?" message={`${toUnsub?.email} will stop receiving campaigns. Only they can opt back in.`} confirmLabel="Unsubscribe" onConfirm={unsubscribe} onCancel={() => setToUnsub(null)} />
      <ConfirmDialog open={!!toRemove} danger title="Delete subscriber?" message={`${toRemove?.email} will be removed permanently, including their opt-out record.`} confirmLabel="Delete" onConfirm={remove} onCancel={() => setToRemove(null)} />
    </div>
  );
}
