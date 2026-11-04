import { Suspense, type ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Spinner } from "@/components/ui";

// Auth-gated, client-rendered area: navigation into it waits on the session check by design.
export const instant = false;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Spinner />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
