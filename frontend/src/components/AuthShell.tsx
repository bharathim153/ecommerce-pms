import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/" className="mb-6 text-lg font-semibold text-indigo-700">Product Manager</Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
