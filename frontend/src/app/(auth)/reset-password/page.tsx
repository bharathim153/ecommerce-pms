"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Field } from "@/components/ui";
import { useToast } from "@/context/ToastContext";
import { api, parseError } from "@/lib/api";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { notify } = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const token = params.get("token") ?? "";
  const email = params.get("email") ?? "";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setErrors({ password_confirmation: "Passwords do not match." });
    setBusy(true);
    setErrors({});
    try {
      await api.post("/auth/reset-password", { token, email, password, password_confirmation: confirm });
      notify("success", "Password updated. Please sign in.");
      router.replace("/login");
    } catch (err) {
      const info = parseError(err);
      setErrors(Object.keys(info.fieldErrors).length ? info.fieldErrors : { password: info.message });
    } finally {
      setBusy(false);
    }
  }

  if (!token || !email) {
    return <Card title="Reset password"><p className="text-sm text-red-700">This reset link is invalid. <Link href="/forgot-password" className="underline">Request a new one</Link>.</p></Card>;
  }

  return (
    <Card title="Choose a new password">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="8+ characters with upper, lower case and a number." />
        <Field label="Confirm password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.password_confirmation} />
        <Button type="submit" loading={busy} disabled={!password} className="w-full">Update password</Button>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return <AuthShell><Suspense fallback={null}><ResetForm /></Suspense></AuthShell>;
}
