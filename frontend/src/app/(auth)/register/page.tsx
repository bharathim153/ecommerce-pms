"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Field } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { parseError } from "@/lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", password_confirmation: "", marketing_opt_in: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: "name" | "email" | "password" | "password_confirmation") => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = "Name is required.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) local.email = "Enter a valid email.";
    if (form.password.length < 8) local.password = "Use at least 8 characters.";
    else if (!/[a-z]/.test(form.password) || !/[A-Z]/.test(form.password) || !/\d/.test(form.password)) local.password = "Include upper and lower case letters and a number.";
    if (form.password !== form.password_confirmation) local.password_confirmation = "Passwords do not match.";
    setErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await register(form);
      notify("success", "Account created. Check your email to verify your address.");
      router.replace("/account");
    } catch (err) {
      const info = parseError(err);
      setErrors(Object.keys(info.fieldErrors).length ? info.fieldErrors : { email: info.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <Card title="Create your account">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Full name" autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
          <Field label="Email" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
          <Field label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} error={errors.password} hint="8+ characters with upper, lower case and a number." />
          <Field label="Confirm password" type="password" autoComplete="new-password" value={form.password_confirmation} onChange={set("password_confirmation")} error={errors.password_confirmation} />
          <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className="mt-1" checked={form.marketing_opt_in} onChange={(e) => setForm({ ...form, marketing_opt_in: e.target.checked })} /> Send me product news and offers by email (optional). You can unsubscribe at any time.</label>
          <Button type="submit" loading={busy} className="w-full">Create account</Button>
        </form>
        <p className="mt-4 text-sm text-slate-600">Already registered? <Link href="/login" className="text-indigo-600 hover:underline">Sign in</Link></p>
      </Card>
    </AuthShell>
  );
}
