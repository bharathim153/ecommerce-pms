import { Suspense, type ReactNode } from "react";
import { ShopHeader } from "@/components/shop/ShopHeader";

export const instant = false;

export default function ShopLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <ShopHeader />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Suspense fallback={null}>{children}</Suspense>
      </main>
    </div>
  );
}
