"use client";

import { useState } from "react";
import { Tooltip } from "./Tooltip";
import { useWidth } from "./useWidth";

export interface Bar { label: string; value: number }

/** Ranked horizontal bars, one hue (nominal categories get one color, never a value ramp). Value at the tip. */
export function HBarChart({ data, unit, label }: { data: Bar[]; unit: string; label: string }) {
  const [ref, width] = useWidth(480);
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  const rows = [...data].sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const labelW = 84, valueW = 44, rowH = 34, barH = 14;
  const iw = Math.max(40, width - labelW - valueW);
  const hp = hover ? rows[hover.i] : null;

  return (
    <div ref={ref} className="relative w-full min-w-0 [contain:inline-size]" onPointerLeave={() => setHover(null)}>
      <svg width={width} height={rows.length * rowH} role="group" aria-label={label} className="block">
        {rows.map((r, i) => {
          const w = (r.value / max) * iw;
          const rr = Math.min(4, w);
          const y0 = i * rowH + (rowH - barH) / 2;
          const d = w > 0 ? `M${labelW},${y0} L${labelW + w - rr},${y0} Q${labelW + w},${y0} ${labelW + w},${y0 + rr} L${labelW + w},${y0 + barH - rr} Q${labelW + w},${y0 + barH} ${labelW + w - rr},${y0 + barH} L${labelW},${y0 + barH} Z` : "";
          return (
            <g key={r.label}>
              <text x={0} y={i * rowH + rowH / 2} dy="0.32em" fontSize={12} fill="var(--viz-ink-2)" className="capitalize">{r.label}</text>
              <path d={d} fill={hover?.i === i ? "var(--viz-s1-hover)" : "var(--viz-s1)"} />
              <text x={labelW + w + 8} y={i * rowH + rowH / 2} dy="0.32em" fontSize={12} fontWeight={600} fill="var(--viz-ink)" style={{ fontVariantNumeric: "tabular-nums" }}>{r.value}</text>
              <rect x={0} y={i * rowH} width={width} height={rowH} fill="transparent" tabIndex={0} role="img" aria-label={`${r.label}: ${r.value} ${unit}${total ? `, ${Math.round((r.value / total) * 100)}%` : ""}`}
                onPointerMove={() => setHover({ i, y: i * rowH })} onFocus={() => setHover({ i, y: i * rowH })} onBlur={() => setHover(null)} className="outline-none focus-visible:stroke-indigo-500" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {hp && hover && <Tooltip x={labelW + (hp.value / max) * iw} y={hover.y - 6} width={width} title={hp.label[0].toUpperCase() + hp.label.slice(1)} rows={[{ key: <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--viz-s1)" }} />, value: String(hp.value), name: `${unit}${total ? ` · ${Math.round((hp.value / total) * 100)}%` : ""}` }]} />}
    </div>
  );
}
