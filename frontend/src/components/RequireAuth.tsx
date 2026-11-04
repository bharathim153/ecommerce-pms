"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { Spinner } from "@/components/ui";
import type { Role } from "@/types";

export function RequireAuth({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (role && user.role !== role) router.replace(user.role === "admin" ? "/admin" : "/account");
  }, [loading, user, role, router, path]);

  if (loading || !user || (role && user.role !== role)) return <Spinner />;
  return <>{children}</>;
}
