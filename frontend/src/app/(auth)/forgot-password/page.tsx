"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Field } from "@/components/ui";
import { api, parseError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      setError(parseError(err).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <Card title="Forgot password">
        {sent ? (
          <p className="text-sm text-slate-700">If an account exists for <strong>{email}</strong>, a reset link has been sent.</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
            <Button type="submit" loading={busy} disabled={!email} className="w-full">Send reset link</Button>
          </form>
        )}
        <p className="mt-4 text-sm"><Link href="/login" className="text-indigo-600 hover:underline">Back to sign in</Link></p>
      </Card>
    </AuthShell>
  );
}
