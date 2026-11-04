"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";

/** Renders the server's own output (sanitised + merge tags + footer) in a fully sandboxed iframe. */
export function EmailPreview({ subject, html }: { subject: string; html: string }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState("");
  const [subj, setSubj] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  async function show() {
    setOpen(true); setLoading(true); setError("");
    try {
      const { data } = await api.post<ApiEnvelope<{ subject: string; html: string }>>("/admin/email/preview", { subject, body_html: html || " " });
      setDoc(data.data.html); setSubj(data.data.subject);
    } catch (e) { setError(parseError(e).message); } finally { setLoading(false); }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={show}>Preview</Button>
      <dialog ref={dlg} onClose={() => setOpen(false)} className="m-auto h-[85vh] w-full max-w-4xl rounded-xl p-0 backdrop:bg-black/40">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 p-3">
            <div className="min-w-0"><p className="text-xs text-slate-500">Subject</p><p className="truncate text-sm font-medium">{subj || subject || "(no subject)"}</p></div>
            <div className="flex gap-2">
              <Button type="button" variant={width === "desktop" ? "primary" : "secondary"} onClick={() => setWidth("desktop")}>Desktop</Button>
              <Button type="button" variant={width === "mobile" ? "primary" : "secondary"} onClick={() => setWidth("mobile")}>Mobile</Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto bg-slate-100 p-4">
            {loading ? <p className="p-8 text-center text-slate-500">Rendering…</p> : error ? <p className="p-8 text-center text-red-700">{error}</p> : (
              <iframe title="Email preview" sandbox="" srcDoc={doc} className="mx-auto h-full min-h-[60vh] w-full rounded border border-slate-200 bg-white" style={{ maxWidth: width === "mobile" ? 375 : 720 }} />
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
