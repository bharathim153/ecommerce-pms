"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";

const TABS = [{ href: "/account", label: "Profile" }, { href: "/account/orders", label: "Orders" }, { href: "/account/security", label: "Security" }];

export function AccountShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  return (
    <RequireAuth>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-semibold text-slate-900">My account</h1><p className="text-sm text-slate-500">{user?.email}</p></div>
          <div className="flex gap-2">
            {user?.role === "admin" && <Link href="/admin" className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50">Admin area</Link>}
            <Button variant="secondary" onClick={async () => { await logout(); router.replace("/login"); }}>Sign out</Button>
          </div>
        </div>
        <nav aria-label="Account" className="flex gap-1 border-b border-slate-200">
          {TABS.map((t) => {
            const active = t.href === "/account" ? path === "/account" : path.startsWith(t.href);
            return <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${active ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-600 hover:text-slate-900"}`}>{t.label}</Link>;
          })}
        </nav>
        {children}
      </div>
    </RequireAuth>
  );
}
