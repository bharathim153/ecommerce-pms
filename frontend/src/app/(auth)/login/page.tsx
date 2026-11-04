"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Button, Card, Field } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { parseError } from "@/lib/api";
import type { User } from "@/types";

function LoginForm() {
  const { login, verifyMfa, resendMfa } = useAuth();
  const { notify } = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaEmail, setMfaEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const verified = params.get("verified");

  function done(user: User) {
    const next = params.get("next");
    router.replace(next && next.startsWith("/") ? next : user.role === "admin" ? "/admin" : "/account");
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await login(email, password);
      if ("mfa_required" in res) {
        setMfaEmail(res.email);
        notify("info", "We emailed you a 6-digit code.");
      } else done(res);
    } catch (err) {
      setError(parseError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault();
    if (!mfaEmail) return;
    setBusy(true);
    setError("");
    try {
      done(await verifyMfa(mfaEmail, code));
    } catch (err) {
      setError(parseError(err).message);
    } finally {
      setBusy(false);
    }
  }

  async function onResend() {
    if (!mfaEmail) return;
    try {
      await resendMfa(mfaEmail);
      notify("success", "A new code was sent.");
    } catch (err) {
      notify("error", parseError(err).message);
    }
  }

  if (mfaEmail) {
    return (
      <Card title="Enter verification code">
        <form onSubmit={onVerify} className="space-y-4" noValidate>
          <p className="text-sm text-slate-600">Code sent to <strong>{mfaEmail}</strong>. It expires in 10 minutes.</p>
          <Field label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} error={error} autoFocus />
          <Button type="submit" loading={busy} disabled={code.length !== 6} className="w-full">Verify &amp; sign in</Button>
          <div className="flex justify-between text-sm">
            <button type="button" onClick={onResend} className="text-indigo-600 hover:underline">Resend code</button>
            <button type="button" onClick={() => { setMfaEmail(null); setCode(""); setError(""); }} className="text-slate-600 hover:underline">Back</button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card title="Sign in">
      {verified === "1" && <p className="mb-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">Email verified. You can sign in.</p>}
      {verified === "0" && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-800">That verification link is invalid or expired.</p>}
      <form onSubmit={onLogin} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
        <Button type="submit" loading={busy} disabled={!email || !password} className="w-full">Sign in</Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-indigo-600 hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-indigo-600 hover:underline">Create account</Link>
      </div>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
