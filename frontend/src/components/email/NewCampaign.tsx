"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Campaign, EmailTemplate } from "@/types";

export function NewCampaign() {
  const router = useRouter();
  const params = useSearchParams();
  const { notify } = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState(params.get("template") ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<ApiEnvelope<{ items: EmailTemplate[] }>>("/admin/email/templates", { params: { per_page: 100 } }).then((r) => setTemplates(r.data.data.items)).catch((e) => notify("error", parseError(e).message)); }, [notify]);

  async function create() {
    setBusy(true);
    try {
      const body = templateId ? { template_id: Number(templateId) } : { subject: "Untitled campaign", body_html: "<p>Write your message here…</p>" };
      const { data } = await api.post<ApiEnvelope<Campaign>>("/admin/email/campaigns", body);
      router.replace(`/admin/email/campaigns/${data.data.id}`);
    } catch (e) { notify("error", parseError(e).message); setBusy(false); }
  }

  if (!templates) return <Spinner label="Loading templates" />;
  return (
    <div className="max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold text-slate-900">New campaign</h1>
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <div>
          <label htmlFor="tpl" className="mb-1 block text-sm font-medium text-slate-700">Start from</label>
          <select id="tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="">Blank message</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">The campaign keeps its own copy, so editing a template later won&apos;t change a campaign already created.</p>
        </div>
        <Button onClick={create} loading={busy}>Create draft</Button>
      </div>
    </div>
  );
}
