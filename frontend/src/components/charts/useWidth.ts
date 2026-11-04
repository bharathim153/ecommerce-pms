"use client";

import { useCallback, useRef, useState } from "react";

/** Measures an element's width (and keeps it current). Callback-ref form so it works with conditional mounting. */
export function useWidth(initial = 640): [(el: HTMLElement | null) => void, number] {
  const [w, setW] = useState(initial);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect();
    if (!el) return;
    setW(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    ro.current = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.current.observe(el);
  }, []);
  return [ref, w];
}
