"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export interface CartLine { product_id: number; slug: string; name: string; price: number; image: string | null; stock: number; quantity: number }

interface CartApi {
  lines: CartLine[];
  count: number;
  subtotal: number;
  ready: boolean;
  add: (line: Omit<CartLine, "quantity">, qty?: number) => void;
  setQty: (productId: number, qty: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
}

const KEY = "pms_cart_v1";
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  // Display-only cache: the server re-prices every order from the database, so tampering here gains nothing.
  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) setLines(JSON.parse(raw));
      } catch { /* storage unavailable or corrupt: start empty */ }
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* ignore */ }
  }, [lines, ready]);

  const api = useMemo<CartApi>(() => ({
    lines,
    ready,
    count: lines.reduce((n, l) => n + l.quantity, 0),
    subtotal: lines.reduce((n, l) => n + l.price * l.quantity, 0),
    add(line, qty = 1) {
      setLines((cur) => {
        const found = cur.find((l) => l.product_id === line.product_id);
        if (found) return cur.map((l) => l.product_id === line.product_id ? { ...l, ...line, quantity: Math.min(l.quantity + qty, line.stock, 100) } : l);
        return [...cur, { ...line, quantity: Math.min(qty, line.stock, 100) }];
      });
    },
    setQty(id, qty) {
      setLines((cur) => cur.map((l) => l.product_id === id ? { ...l, quantity: Math.max(1, Math.min(qty, l.stock, 100)) } : l));
    },
    remove(id) { setLines((cur) => cur.filter((l) => l.product_id !== id)); },
    clear() { setLines([]); },
  }), [lines, ready]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be used within CartProvider");
  return c;
}
