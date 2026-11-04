"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { Button } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/email/campaigns", label: "Campaigns" },
  { href: "/admin/email/templates", label: "Email templates" },
  { href: "/admin/email/subscribers", label: "Subscribers" },
  { href: "/admin/exports", label: "PDF exports" },
  { href: "/admin/payment-settings", label: "Payment settings" },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-1 p-3">
      {NAV.map((n) => {
        const active = n.href === "/admin" ? path === "/admin" : path.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-2 text-sm font-medium ${active ? "bg-indigo-50 text-indigo-700" : "text-slate-700 hover:bg-slate-100"}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <RequireAuth role="admin">
      <div className="flex min-h-screen bg-slate-50">
        <aside className="hidden w-56 shrink-0 border-r border-slate-200 bg-white md:block">
          <div className="p-4 text-lg font-semibold text-indigo-700">Product Manager</div>
          {nav}
        </aside>
        {open && (
          <div className="fixed inset-0 z-40 md:hidden" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <aside className="relative h-full w-56 bg-white" onClick={(e) => e.stopPropagation()}>
              <div className="p-4 text-lg font-semibold text-indigo-700">Product Manager</div>
              {nav}
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
            <button className="rounded p-1 md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>☰</button>
            <span className="hidden text-sm text-slate-500 md:block">{user?.email}</span>
            <Button variant="secondary" onClick={async () => { await logout(); router.replace("/login"); }}>Sign out</Button>
          </header>
          <main className="flex-1 p-4 md:p-8">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
