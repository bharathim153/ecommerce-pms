"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Spinner } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";

interface Secret { set: boolean; hint: string | null; source: string }
interface Plain { value: string | boolean | null; source: string }
interface Settings {
  currency: Plain; stripe_enabled: Plain; paypal_enabled: Plain; paypal_mode: Plain; paypal_client_id: Plain; paypal_webhook_id: Plain;
  stripe_secret_key: Secret; stripe_webhook_secret: Secret; paypal_client_secret: Secret;
  stripe_status: { configured: boolean; enabled: boolean }; paypal_status: { configured: boolean; enabled: boolean };
  webhook_urls: { stripe: string; paypal: string };
}

const truthy = (v: unknown) => v === true || v === "1" || v === 1 || v === "true";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{label}</span>;
}

export function PaymentSettingsForm() {
  const { notify } = useToast();
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState({ currency: "USD", stripe_enabled: true, paypal_enabled: true, paypal_mode: "sandbox", paypal_client_id: "", paypal_webhook_id: "", stripe_secret_key: "", stripe_webhook_secret: "", paypal_client_secret: "" });

  function hydrate(d: Settings) {
    setS(d);
    setF((cur) => ({ ...cur, currency: String(d.currency.value ?? "USD"), stripe_enabled: truthy(d.stripe_enabled.value ?? true), paypal_enabled: truthy(d.paypal_enabled.value ?? true), paypal_mode: String(d.paypal_mode.value ?? "sandbox"), paypal_client_id: String(d.paypal_client_id.value ?? ""), paypal_webhook_id: String(d.paypal_webhook_id.value ?? ""), stripe_secret_key: "", stripe_webhook_secret: "", paypal_client_secret: "" }));
  }

  useEffect(() => { api.get<ApiEnvelope<Settings>>("/admin/payment-settings").then((r) => hydrate(r.data.data)).catch((e) => setError(parseError(e).message)); }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setErrors({});
    try {
      const { data } = await api.put<ApiEnvelope<Settings>>("/admin/payment-settings", f);
      hydrate({ ...data.data, webhook_urls: s!.webhook_urls });
      notify("success", "Payment settings saved.");
    } catch (err) {
      const info = parseError(err);
      if (Object.keys(info.fieldErrors).length) setErrors(info.fieldErrors); else notify("error", info.message);
    } finally { setSaving(false); }
  }

  if (error) return <p className="text-red-700">{error}</p>;
  if (!s) return <Spinner label="Loading settings" />;

  const sec = (k: "stripe_secret_key" | "stripe_webhook_secret" | "paypal_client_secret") => s[k].set ? `Saved ${s[k].hint} (${s[k].source}). Leave blank to keep.` : "Not set";
  const card = "space-y-4 rounded-xl border border-slate-200 bg-white p-5";

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6" noValidate>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Payment settings</h1>
        <Button type="submit" loading={saving}>Save settings</Button>
      </div>
      <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Use Stripe <strong>test</strong> keys and PayPal <strong>sandbox</strong> credentials while developing. Secrets are stored encrypted and are never shown again. Values from the server environment are used when nothing is saved here.</p>

      <section className={card}>
        <h2 className="font-medium">General</h2>
        <Field label="Currency (ISO code)" value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} error={errors.currency} />
      </section>

      <section className={card}>
        <div className="flex items-center justify-between"><h2 className="font-medium">Stripe</h2><div className="flex gap-2"><Status ok={s.stripe_status.configured} label={s.stripe_status.configured ? "Configured" : "Not configured"} /><Status ok={s.stripe_status.enabled} label={s.stripe_status.enabled ? "Live in checkout" : "Hidden"} /></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.stripe_enabled} onChange={(e) => setF({ ...f, stripe_enabled: e.target.checked })} /> Enable card payments</label>
        <Field label="Secret key (sk_test_…)" type="password" autoComplete="off" value={f.stripe_secret_key} onChange={(e) => setF({ ...f, stripe_secret_key: e.target.value })} error={errors.stripe_secret_key} hint={sec("stripe_secret_key")} />
        <Field label="Webhook signing secret (whsec_…)" type="password" autoComplete="off" value={f.stripe_webhook_secret} onChange={(e) => setF({ ...f, stripe_webhook_secret: e.target.value })} error={errors.stripe_webhook_secret} hint={sec("stripe_webhook_secret")} />
        <p className="text-xs text-slate-500">Webhook endpoint: <code className="rounded bg-slate-100 px-1">{s.webhook_urls.stripe}</code> · events: checkout.session.completed, checkout.session.expired, charge.refunded</p>
      </section>

      <section className={card}>
        <div className="flex items-center justify-between"><h2 className="font-medium">PayPal</h2><div className="flex gap-2"><Status ok={s.paypal_status.configured} label={s.paypal_status.configured ? "Configured" : "Not configured"} /><Status ok={s.paypal_status.enabled} label={s.paypal_status.enabled ? "Live in checkout" : "Hidden"} /></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.paypal_enabled} onChange={(e) => setF({ ...f, paypal_enabled: e.target.checked })} /> Enable PayPal</label>
        <div>
          <label htmlFor="mode" className="mb-1 block text-sm font-medium text-slate-700">Mode</label>
          <select id="mode" value={f.paypal_mode} onChange={(e) => setF({ ...f, paypal_mode: e.target.value })} className="rounded-md border border-slate-300 px-3 py-2 text-sm"><option value="sandbox">Sandbox</option><option value="live">Live</option></select>
        </div>
        <Field label="Client ID" value={f.paypal_client_id} onChange={(e) => setF({ ...f, paypal_client_id: e.target.value })} error={errors.paypal_client_id} />
        <Field label="Client secret" type="password" autoComplete="off" value={f.paypal_client_secret} onChange={(e) => setF({ ...f, paypal_client_secret: e.target.value })} error={errors.paypal_client_secret} hint={sec("paypal_client_secret")} />
        <Field label="Webhook ID" value={f.paypal_webhook_id} onChange={(e) => setF({ ...f, paypal_webhook_id: e.target.value })} error={errors.paypal_webhook_id} />
        <p className="text-xs text-slate-500">Webhook endpoint: <code className="rounded bg-slate-100 px-1">{s.webhook_urls.paypal}</code> · events: PAYMENT.CAPTURE.COMPLETED, DENIED, REFUNDED</p>
      </section>
    </form>
  );
}
