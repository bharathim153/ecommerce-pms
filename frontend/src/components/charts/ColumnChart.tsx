"use client";

import { useState } from "react";
import { longDate, niceTicks, shortDate, tickFormatter } from "./scale";
import { LineKey, Tooltip } from "./Tooltip";
import type { Point } from "./LineChart";
import { useWidth } from "./useWidth";

/** Single-series columns: ≤24px thick, 4px rounded top, square on the baseline. The bar itself is the hit target. */
export function ColumnChart({ data, name, format, height = 220, label }: { data: Point[]; name: string; format: (v: number) => string; height?: number; label: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 40, r: 12, t: 14, b: 28 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const n = data.length;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(Math.max(max, 4)); // integer counts: keep ticks whole
  const top = ticks[ticks.length - 1] || 1;
  const fmt = tickFormatter(top);
  const band = n ? iw / n : iw;
  const bw = Math.max(2, Math.min(24, band * 0.62));
  const cx = (i: number) => m.l + band * i + band / 2;
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const xLabels = n <= 1 ? [0] : Array.from(new Set([0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1]));
  const r = 4;

  const bar = (i: number, v: number) => {
    const h = Math.max(0, y(0) - y(v));
    if (h === 0) return "";
    const rr = Math.min(r, h, bw / 2);
    const x0 = cx(i) - bw / 2, x1 = cx(i) + bw / 2, yt = y(v), yb = y(0);
    return `M${x0},${yb} L${x0},${yt + rr} Q${x0},${yt} ${x0 + rr},${yt} L${x1 - rr},${yt} Q${x1},${yt} ${x1},${yt + rr} L${x1},${yb} Z`;
  };
  const hp = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full min-w-0 [contain:inline-size]" style={{ minHeight: height }} onPointerLeave={() => setHover(null)}>
      <svg width={width} height={height} role="group" aria-label={`${label}. ${n} days.`} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(t)}</text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={cx(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={11} fill="var(--viz-muted)">{data[i] && shortDate(data[i].date)}</text>
        ))}
        {data.map((d, i) => (
          <g key={d.date}>
            <path d={bar(i, d.value)} fill={hover === i ? "var(--viz-s1-hover)" : "var(--viz-s1)"} />
            {/* full-height transparent hit area, wider than the mark; focusable so keyboard users get the same readout */}
            <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" tabIndex={0} role="img" aria-label={`${longDate(d.date)}: ${format(d.value)} ${name}`}
              onPointerMove={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="outline-none focus-visible:stroke-indigo-500" strokeWidth={2} />
          </g>
        ))}
      </svg>
      {hp && hover !== null && <Tooltip x={cx(hover)} y={y(hp.value) - 24} width={width} title={longDate(hp.date)} rows={[{ key: <LineKey />, value: format(hp.value), name }]} />}
    </div>
  );
}
