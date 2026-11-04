"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, parseError, type ApiEnvelope } from "@/lib/api";

export function ProfileView() {
  const { user, refresh } = useAuth();
  const { notify } = useToast();
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [marketing, setMarketing] = useState<boolean | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => { api.get<ApiEnvelope<{ subscribed: boolean }>>("/auth/marketing").then((r) => setMarketing(r.data.data.subscribed)).catch(() => setMarketing(null)); }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: "Name is required." });
    setSaving(true); setErrors({});
    try {
      await api.patch("/auth/profile", { name, phone: phone || null });
      await refresh();
      notify("success", "Profile updated.");
    } catch (err) {
      const i = parseError(err);
      if (Object.keys(i.fieldErrors).length) setErrors(i.fieldErrors); else notify("error", i.message);
    } finally { setSaving(false); }
  }

  async function toggleMarketing(next: boolean) {
    try { await api.patch("/auth/marketing", { subscribed: next }); setMarketing(next); notify("success", next ? "You will receive our emails." : "You have been unsubscribed."); }
    catch (err) { notify("error", parseError(err).message); }
  }

  async function resend() {
    setResending(true);
    try { await api.post("/auth/email/resend"); notify("success", "Verification email sent."); } catch (e) { notify("error", parseError(e).message); } finally { setResending(false); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6" noValidate aria-label="Profile">
        <h2 className="font-medium text-slate-900">Profile</h2>
        <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={255} autoComplete="name" />
        <Field label="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} error={errors.phone} maxLength={30} autoComplete="tel" inputMode="tel" />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Email</p>
          <p className="text-sm text-slate-900">{user?.email} {user?.email_verified ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Verified</span> : <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Not verified</span>}</p>
          {!user?.email_verified && <p className="mt-1 text-sm text-slate-600">You need a verified email to check out. <button type="button" onClick={resend} disabled={resending} className="text-indigo-600 underline disabled:opacity-60">Resend verification email</button></p>}
        </div>
        <Button type="submit" loading={saving}>Save changes</Button>
      </form>

      <section aria-label="Email preferences" className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-medium text-slate-900">Email preferences</h2>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" disabled={marketing === null} checked={!!marketing} onChange={(e) => toggleMarketing(e.target.checked)} /> Send me product news and offers</label>
        <p className="mt-1 text-xs text-slate-500">Order confirmations and account messages are always sent.</p>
      </section>
    </div>
  );
}
