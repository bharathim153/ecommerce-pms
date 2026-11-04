"use client";

import Link from "next/link";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";

export function ShopHeader() {
  const { count } = useCart();
  const { user, loading } = useAuth();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-semibold text-indigo-700">Product Manager</Link>
        <nav aria-label="Main" className="flex items-center gap-5 text-sm font-medium text-slate-700">
          <Link href="/shop" className="hover:text-indigo-700">Shop</Link>
          <Link href="/cart" className="hover:text-indigo-700">Cart{count > 0 && <span className="ml-1 rounded-full bg-indigo-600 px-1.5 py-0.5 text-xs text-white" aria-label={`${count} items`}>{count}</span>}</Link>
          {loading ? null : user ? (
            <Link href={user.role === "admin" ? "/admin" : "/account"} className="hover:text-indigo-700">{user.role === "admin" ? "Admin" : "Account"}</Link>
          ) : (
            <Link href="/login" className="hover:text-indigo-700">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
