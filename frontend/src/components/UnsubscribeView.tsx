"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";

export function UnsubscribeView() {
  const token = useSearchParams().get("token") ?? "";
  const [info, setInfo] = useState<{ email: string; subscribed: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get<ApiEnvelope<{ email: string; subscribed: boolean }>>(`/unsubscribe/${encodeURIComponent(token)}`).then((r) => setInfo(r.data.data)).catch((e) => setError(parseError(e).message));
  }, [token]);

  async function act(path: "unsubscribe" | "resubscribe") {
    setBusy(true);
    try { await api.post(`/${path}/${encodeURIComponent(token)}`); setInfo((i) => i && { ...i, subscribed: path === "resubscribe" }); }
    catch (e) { setError(parseError(e).message); } finally { setBusy(false); }
  }

  return (
    <AuthShell>
      <Card title="Email preferences">
        {!token || error ? <p className="text-sm text-red-700">{error || "This unsubscribe link is not valid."}</p>
          : !info ? <Spinner label="Loading" />
          : info.subscribed ? (
            <div className="space-y-4"><p className="text-sm text-slate-700">Stop sending marketing email to <strong>{info.email}</strong>?</p><Button variant="danger" loading={busy} onClick={() => act("unsubscribe")}>Unsubscribe</Button></div>
          ) : (
            <div className="space-y-4"><p role="status" className="text-sm text-slate-700"><strong>{info.email}</strong> is unsubscribed. You won&apos;t receive any more marketing email from us.</p><p className="text-sm text-slate-500">Changed your mind?</p><Button variant="secondary" loading={busy} onClick={() => act("resubscribe")}>Subscribe again</Button></div>
          )}
      </Card>
    </AuthShell>
  );
}
