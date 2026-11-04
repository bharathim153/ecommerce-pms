"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { EmailEditor } from "@/components/email/EmailEditor";
import { EmailPreview } from "@/components/email/EmailPreview";
import { Button, Field } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { EmailTemplate } from "@/types";

export function TemplateForm({ template }: { template?: EmailTemplate }) {
  const router = useRouter();
  const { notify } = useToast();
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [html, setHtml] = useState(template?.body_html ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = "Name is required.";
    if (!subject.trim()) local.subject = "Subject is required.";
    if (!html.trim()) local.body_html = "Add some content.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const body = { name, subject, body_html: html };
      if (template) await api.put<ApiEnvelope<EmailTemplate>>(`/admin/email/templates/${template.id}`, body);
      else await api.post<ApiEnvelope<EmailTemplate>>("/admin/email/templates", body);
      notify("success", template ? "Template updated." : "Template created.");
      router.push("/admin/email/templates");
    } catch (err) {
      const info = parseError(err);
      if (Object.keys(info.fieldErrors).length) setErrors(info.fieldErrors); else notify("error", info.message);
    } finally { setSaving(false); }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-4xl space-y-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{template ? "Edit template" : "New template"}</h1>
        <div className="flex gap-2">
          <EmailPreview subject={subject} html={html} />
          <Button type="button" variant="ghost" onClick={() => router.push("/admin/email/templates")}>Cancel</Button>
          <Button type="submit" loading={saving}>{template ? "Save changes" : "Create template"}</Button>
        </div>
      </div>
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <Field label="Template name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={255} />
        <Field label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} error={errors.subject} maxLength={255} />
      </div>
      <EmailEditor value={html} onChange={setHtml} />
      {errors.body_html && <p className="text-sm text-red-600">{errors.body_html}</p>}
    </form>
  );
}
