"use client";

import { useState, type FormEvent } from "react";
import { Button, Field } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, parseError } from "@/lib/api";

export function SecurityView() {
  const { user, refresh } = useAuth();
  const { notify } = useToast();
  const [f, setF] = useState({ current_password: "", password: "", password_confirmation: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [mfaPw, setMfaPw] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.current_password) local.current_password = "Enter your current password.";
    if (f.password.length < 8 || !/[a-z]/.test(f.password) || !/[A-Z]/.test(f.password) || !/\d/.test(f.password)) local.password = "Use 8+ characters with upper and lower case letters and a number.";
    if (f.password !== f.password_confirmation) local.password_confirmation = "Passwords do not match.";
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api.put("/auth/password", f);
      setF({ current_password: "", password: "", password_confirmation: "" });
      notify("success", "Password changed. Other devices were signed out.");
    } catch (err) {
      const i = parseError(err);
      setErrors(Object.keys(i.fieldErrors).length ? i.fieldErrors : { current_password: i.message });
    } finally { setBusy(false); }
  }

  async function toggleMfa() {
    setMfaBusy(true);
    try {
      await api.patch("/auth/mfa", { enabled: !user?.mfa_enabled, password: mfaPw });
      await refresh(); setMfaPw("");
      notify("success", `Email one-time codes ${user?.mfa_enabled ? "turned off" : "turned on"}.`);
    } catch (err) { notify("error", parseError(err).message); } finally { setMfaBusy(false); }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={changePassword} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6" noValidate aria-label="Change password">
        <h2 className="font-medium text-slate-900">Change password</h2>
        <Field label="Current password" type="password" autoComplete="current-password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} error={errors.current_password} />
        <Field label="New password" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={errors.password} hint="8+ characters with upper, lower case and a number." />
        <Field label="Confirm new password" type="password" autoComplete="new-password" value={f.password_confirmation} onChange={(e) => setF({ ...f, password_confirmation: e.target.value })} error={errors.password_confirmation} />
        <Button type="submit" loading={busy}>Update password</Button>
      </form>

      <section aria-label="Two-step verification" className="space-y-3 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="font-medium text-slate-900">Two-step verification</h2>
        <p className="text-sm text-slate-600">When on, we email you a 6-digit code each time you sign in. Currently <strong>{user?.mfa_enabled ? "on" : "off"}</strong>.</p>
        <div className="flex gap-2">
          <input type="password" aria-label="Current password to confirm" placeholder="Current password" value={mfaPw} onChange={(e) => setMfaPw(e.target.value)} className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm" autoComplete="current-password" />
          <Button onClick={toggleMfa} loading={mfaBusy} disabled={!mfaPw}>{user?.mfa_enabled ? "Turn off" : "Turn on"}</Button>
        </div>
      </section>
    </div>
  );
}
