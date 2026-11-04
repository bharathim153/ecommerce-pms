"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { STATUS_BADGE } from "@/components/email/CampaignsList";
import { EmailEditor } from "@/components/email/EmailEditor";
import { EmailPreview } from "@/components/email/EmailPreview";
import { Button, Field, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import type { Campaign, CampaignLog, PageMeta } from "@/types";

const LOG_BADGE: Record<string, string> = { sent: "bg-blue-100 text-blue-800", delivered: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-800", bounced: "bg-amber-100 text-amber-800", skipped: "bg-slate-100 text-slate-600", queued: "bg-slate-100 text-slate-600", sending: "bg-blue-50 text-blue-700" };

export function CampaignView() {
  const { id } = useParams<{ id: string }>();
  const { notify } = useToast();
  const [c, setC] = useState<Campaign | null>(null);
  const [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [eligible, setEligible] = useState<number | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [sending, setSending] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [logMeta, setLogMeta] = useState<Pick<PageMeta, "current_page" | "last_page" | "total"> | null>(null);
  const [logStatus, setLogStatus] = useState("");
  const [logPage, setLogPage] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<ApiEnvelope<Campaign>>(`/admin/email/campaigns/${id}`);
      setC(data.data);
      return data.data;
    } catch (e) { setError(parseError(e).status === 404 ? "Campaign not found." : parseError(e).message); return null; }
  }, [id]);

  // First load seeds the editor; later polls must not overwrite what the admin is typing.
  useEffect(() => { Promise.resolve().then(async () => { const d = await load(); if (d) { setSubject(d.subject); setHtml(d.body_html ?? ""); } }); }, [load]);

  const loadLogs = useCallback(async () => {
    try {
      const { data } = await api.get<ApiEnvelope<{ items: CampaignLog[]; meta: Pick<PageMeta, "current_page" | "last_page" | "total"> }>>(`/admin/email/campaigns/${id}/logs`, { params: { status: logStatus || undefined, page: logPage } });
      setLogs(data.data.items); setLogMeta(data.data.meta);
    } catch { /* keep the previous page of logs */ }
  }, [id, logStatus, logPage]);

  const status = c?.status;
  useEffect(() => {
    if (!status || status === "draft") return;
    let alive = true;
    const tick = async () => {
      const d = await load(); await loadLogs();
      if (alive && d?.status === "sending") timer.current = setTimeout(tick, 2000);
    };
    Promise.resolve().then(tick);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); };
  }, [status, load, loadLogs]);

  async function save() {
    setSaving(true);
    try {
      const { data } = await api.put<ApiEnvelope<Campaign>>(`/admin/email/campaigns/${id}`, { subject, body_html: html });
      setC(data.data); setHtml(data.data.body_html ?? html); setDirty(false);
      notify("success", "Draft saved.");
      return true;
    } catch (e) { notify("error", parseError(e).message); return false; } finally { setSaving(false); }
  }

  async function sendTest() {
    if (dirty && !(await save())) return;
    try { const { data } = await api.post<ApiEnvelope<null>>(`/admin/email/campaigns/${id}/test`); notify("success", data.message); } catch (e) { notify("error", parseError(e).message); }
  }

  async function openConfirm() {
    if (dirty && !(await save())) return;
    setUnderstood(false); setEligible(null); setConfirmOpen(true);
    try { const { data } = await api.get<ApiEnvelope<{ eligible: number }>>("/admin/email/campaigns/recipients"); setEligible(data.data.eligible); } catch { setEligible(-1); }
  }

  async function launch() {
    setSending(true);
    try {
      const { data } = await api.post<ApiEnvelope<Campaign>>(`/admin/email/campaigns/${id}/send`, { confirm: true });
      setC(data.data); setConfirmOpen(false); notify("success", data.message);
    } catch (e) { notify("error", parseError(e).message); setConfirmOpen(false); load(); } finally { setSending(false); }
  }

  async function cancel() {
    try { const { data } = await api.post<ApiEnvelope<Campaign>>(`/admin/email/campaigns/${id}/cancel`); setC(data.data); notify("info", data.message); } catch (e) { notify("error", parseError(e).message); }
    setCancelOpen(false);
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!c) return <Spinner label="Loading campaign" />;

  const draft = c.status === "draft";
  const done = c.counts.sent + c.counts.failed + c.counts.skipped;
  const pct = c.total_recipients ? Math.min(100, Math.round((done / c.total_recipients) * 100)) : draft ? 0 : 100;

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><h1 className="text-2xl font-semibold text-slate-900">Campaign #{c.id}</h1><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}>{c.status}</span></div>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <EmailPreview subject={subject} html={html} />
              <Button variant="secondary" onClick={sendTest}>Send test to me</Button>
              <Button variant="secondary" onClick={save} loading={saving} disabled={!dirty}>Save draft</Button>
              <Button onClick={openConfirm} disabled={!subject.trim() || !html.trim()}>Send Campaign</Button>
            </>
          ) : (
            <>
              <EmailPreview subject={c.subject} html={c.body_html ?? ""} />
              {c.status === "sending" && <Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel sending</Button>}
            </>
          )}
        </div>
      </div>

      {draft ? (
        <section className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5"><Field label="Subject" value={subject} maxLength={255} onChange={(e) => { setSubject(e.target.value); setDirty(true); }} /></div>
          <EmailEditor value={html} onChange={(v) => { setHtml(v); setDirty(true); }} />
        </section>
      ) : (
        <>
          <section aria-label="Progress" className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
            <p className="font-medium text-slate-900">{c.subject}</p>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sending progress"><div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} /></div>
            <p className="text-sm text-slate-600">{pct}% · {done} of {c.total_recipients} processed{c.status === "sending" && " · running in the background"}</p>
            <dl className="grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
              {(["queued", "sent", "delivered", "failed", "bounced", "skipped"] as const).map((k) => (
                <div key={k} className="rounded-lg bg-slate-50 p-2"><dt className="text-xs capitalize text-slate-500">{k}</dt><dd className="text-lg font-semibold">{c.counts[k]}</dd></div>
              ))}
            </dl>
            <p className="text-xs text-slate-500">&quot;Sent&quot; counts emails accepted by the mail server (it includes delivered and bounced). Delivered and bounced are reported back by providers that support webhooks (Mailgun).</p>
          </section>

          <section aria-label="Delivery log" className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-medium">Delivery log</h2>
              <select aria-label="Filter log" value={logStatus} onChange={(e) => { setLogStatus(e.target.value); setLogPage(1); }} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"><option value="">All</option>{["queued", "sent", "delivered", "failed", "bounced", "skipped"].map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm"><thead className="border-b border-slate-200 bg-slate-50 text-slate-600"><tr><th className="p-3 font-medium">Recipient</th><th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Sent</th><th className="p-3 font-medium">Detail</th></tr></thead>
                <tbody>{logs.length === 0 ? <tr><td colSpan={4} className="p-8 text-center text-slate-500">Nothing here yet.</td></tr> : logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 last:border-0"><td className="p-3">{l.email}</td><td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LOG_BADGE[l.status]}`}>{l.status}</span></td><td className="p-3 text-slate-500">{l.sent_at ? new Date(l.sent_at).toLocaleTimeString() : "—"}</td><td className="max-w-xs truncate p-3 text-slate-500" title={l.error ?? ""}>{l.error}</td></tr>))}</tbody></table>
            </div>
            {logMeta && logMeta.last_page > 1 && <div className="flex items-center justify-between text-sm text-slate-600"><span>Page {logMeta.current_page} of {logMeta.last_page}</span><div className="flex gap-2"><Button variant="secondary" disabled={logPage <= 1} onClick={() => setLogPage(logPage - 1)}>Previous</Button><Button variant="secondary" disabled={logPage >= logMeta.last_page} onClick={() => setLogPage(logPage + 1)}>Next</Button></div></div>}
          </section>
        </>
      )}

      <dialog open={confirmOpen} aria-label="Confirm send" ref={(el) => { if (!el) return; if (confirmOpen && !el.open) el.showModal(); if (!confirmOpen && el.open) el.close(); }} onCancel={(e) => { e.preventDefault(); setConfirmOpen(false); }} className="m-auto w-full max-w-md rounded-xl p-0 backdrop:bg-black/40">
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Send this campaign?</h2>
          <p className="text-sm text-slate-700">Subject: <strong>{subject}</strong></p>
          {eligible === null ? <p className="text-sm text-slate-500">Counting recipients…</p> : eligible === -1 ? <p className="text-sm text-red-700">Could not count recipients.</p> : eligible === 0 ? <p className="text-sm text-amber-700">There are no subscribed recipients, so nothing would be sent.</p> : (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">This will email <strong>{eligible.toLocaleString()}</strong> opted-in subscribers. Unsubscribed and bounced addresses are excluded. <strong>This cannot be undone.</strong></p>
          )}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1" /> I have previewed this email and want to send it now.</label>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={sending}>Cancel</Button><Button onClick={launch} loading={sending} disabled={!understood || !eligible || eligible < 1}>Send Campaign</Button></div>
        </div>
      </dialog>
      <ConfirmDialog open={cancelOpen} danger title="Cancel sending?" message="Emails already sent stay sent. Everyone not yet emailed will be skipped." confirmLabel="Cancel sending" onConfirm={cancel} onCancel={() => setCancelOpen(false)} />
    </div>
  );
}
