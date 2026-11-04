"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { EmailTemplate } from "@/types";

export function TemplatesList() {
  const { notify } = useToast();
  const [items, setItems] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [del, setDel] = useState<EmailTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ApiEnvelope<{ items: EmailTemplate[] }>>("/admin/email/templates");
      setItems(data.data.items); setError("");
    } catch (e) { setError(parseError(e).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);

  async function remove() {
    if (!del) return;
    try { await api.delete(`/admin/email/templates/${del.id}`); notify("success", "Template deleted."); } catch (e) { notify("error", parseError(e).message); }
    setDel(null); load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Email templates</h1>
        <Link href="/admin/email/templates/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">New template</Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3 font-medium">Name</th><th className="p-3 font-medium">Subject</th><th className="p-3 font-medium">Updated</th><th className="p-3" /></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4}><Spinner label="Loading templates" /></td></tr>
              : error ? <tr><td colSpan={4} className="p-8 text-center text-red-700">{error}</td></tr>
              : items.length === 0 ? <tr><td colSpan={4} className="p-10 text-center text-slate-500">No templates yet. <Link href="/admin/email/templates/new" className="text-indigo-600 underline">Create your first template</Link>.</td></tr>
              : items.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0">
                  <td className="p-3 font-medium text-slate-900">{t.name}</td>
                  <td className="p-3 text-slate-600">{t.subject}</td>
                  <td className="p-3 text-slate-500">{new Date(t.updated_at).toLocaleDateString()}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Link href={`/admin/email/campaigns/new?template=${t.id}`} className="mr-3 text-indigo-600 hover:underline">Use in campaign</Link>
                    <Link href={`/admin/email/templates/${t.id}`} className="mr-3 text-indigo-600 hover:underline">Edit</Link>
                    <button className="text-red-600 hover:underline" onClick={() => setDel(t)}>Delete</button>
                  </td>
                </tr>))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!del} danger title="Delete template?" message={`“${del?.name}” will be removed. Campaigns already created from it are not affected.`} confirmLabel="Delete" onConfirm={remove} onCancel={() => setDel(null)} />
    </div>
  );
}
