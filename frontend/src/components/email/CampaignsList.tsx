"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Campaign } from "@/types";

export const STATUS_BADGE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700", sending: "bg-blue-100 text-blue-800", completed: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-800", cancelled: "bg-amber-100 text-amber-800",
};

export function CampaignsList() {
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get<ApiEnvelope<{ items: Campaign[] }>>("/admin/email/campaigns").then((r) => setItems(r.data.data.items)).catch((e) => setError(parseError(e).message)).finally(() => setLoading(false));
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Email campaigns</h1>
        <Link href="/admin/email/campaigns/new" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">New campaign</Link>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3 font-medium">Subject</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Recipients</th><th className="p-3 font-medium">Sent</th><th className="p-3 font-medium">Delivered</th><th className="p-3 font-medium">Failed</th><th className="p-3 font-medium">Bounced</th><th className="p-3 font-medium">Created</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8}><Spinner label="Loading campaigns" /></td></tr>
              : error ? <tr><td colSpan={8} className="p-8 text-center text-red-700">{error}</td></tr>
              : items.length === 0 ? <tr><td colSpan={8} className="p-10 text-center text-slate-500">No campaigns yet. <Link href="/admin/email/campaigns/new" className="text-indigo-600 underline">Create one</Link>.</td></tr>
              : items.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="p-3"><Link href={`/admin/email/campaigns/${c.id}`} className="font-medium text-indigo-700 hover:underline">{c.subject}</Link></td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>{c.status}</span></td>
                  <td className="p-3">{c.total_recipients}</td><td className="p-3">{c.counts.sent}</td><td className="p-3">{c.counts.delivered}</td><td className="p-3">{c.counts.failed}</td><td className="p-3">{c.counts.bounced}</td>
                  <td className="p-3 text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
