"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { PdfExport } from "@/types";

const BADGE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function size(bytes: number | null) {
  if (bytes == null) return "—";
  return bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ExportsList() {
  const { notify } = useToast();
  const [items, setItems] = useState<PdfExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<PdfExport | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ApiEnvelope<{ items: PdfExport[] }>>("/admin/pdf-exports", { params: { per_page: 30 } });
      setItems(data.data.items);
      setError("");
      return data.data.items;
    } catch (err) {
      setError(parseError(err).message);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll every 2s while anything is queued/processing; stop when everything is settled.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const rows = await load();
      if (!alive) return;
      const active = rows.some((r) => r.status === "queued" || r.status === "processing");
      timer.current = setTimeout(tick, active ? 2000 : 10000);
    };
    Promise.resolve().then(tick);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [load]);

  async function download(e: PdfExport) {
    setBusyId(e.id);
    try {
      const res = await api.get(`/admin/pdf-exports/${e.id}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `products-export-${e.id}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      notify("error", parseError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function retry(e: PdfExport) {
    setBusyId(e.id);
    try {
      await api.post(`/admin/pdf-exports/${e.id}/retry`);
      notify("info", "Export re-queued.");
      load();
    } catch (err) {
      notify("error", parseError(err).message);
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await api.delete(`/admin/pdf-exports/${toDelete.id}`);
      notify("success", "Export deleted.");
      setToDelete(null);
      load();
    } catch (err) {
      notify("error", parseError(err).message);
      setToDelete(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">PDF exports</h1>
        <Button variant="secondary" onClick={load}>Refresh</Button>
      </div>
      <p className="text-sm text-slate-600">Large catalogs are built in the background. You can leave this page; the file will be here when it finishes.</p>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
            <tr>
              <th className="p-3 font-medium">#</th>
              <th className="p-3 font-medium">Scope</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Progress</th>
              <th className="p-3 font-medium">Pages</th>
              <th className="p-3 font-medium">Size</th>
              <th className="p-3 font-medium">Created</th>
              <th className="p-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8}><Spinner label="Loading exports" /></td></tr>
            ) : error ? (
              <tr><td colSpan={8} className="p-8 text-center text-red-700">{error}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-10 text-center text-slate-500">No exports yet. Select products on the Products page, or export all.</td></tr>
            ) : items.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 last:border-0">
                <td className="p-3 font-mono text-xs">{e.id}</td>
                <td className="p-3">{e.scope === "all" ? "All products" : "Selected"} <span className="text-slate-500">({e.total_products})</span></td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[e.status]}`}>{e.status}</span>
                  {e.status === "failed" && e.error && <div className="mt-1 max-w-xs truncate text-xs text-red-700" title={e.error}>{e.error}</div>}
                </td>
                <td className="p-3">
                  <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={e.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`Export ${e.id} progress`}>
                    <div className={`h-full ${e.status === "failed" ? "bg-red-500" : "bg-indigo-600"}`} style={{ width: `${e.progress}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">{e.progress}% · {e.processed_products}/{e.total_products}</div>
                </td>
                <td className="p-3">{e.page_count ?? "—"}</td>
                <td className="p-3">{size(e.size_bytes)}</td>
                <td className="p-3 text-slate-600">{new Date(e.created_at).toLocaleString()}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  {e.status === "completed" && <Button variant="secondary" loading={busyId === e.id} onClick={() => download(e)}>Download</Button>}
                  {e.status === "failed" && <Button variant="secondary" loading={busyId === e.id} onClick={() => retry(e)}>Retry</Button>}
                  {(e.status === "completed" || e.status === "failed") && <button className="ml-3 text-red-600 hover:underline" onClick={() => setToDelete(e)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog open={!!toDelete} danger title="Delete export?" message={`Export #${toDelete?.id} and its PDF file will be removed.`} confirmLabel="Delete" onConfirm={confirmDelete} onCancel={() => setToDelete(null)} />
    </div>
  );
}
