"use client";

import { useState } from "react";
import { longDate, niceTicks, shortDate, tickFormatter } from "./scale";
import { LineKey, Tooltip } from "./Tooltip";
import { useWidth } from "./useWidth";

export interface Point { date: string; value: number }

/** Single-series line + 10% area wash. Crosshair snaps to the nearest day; arrow keys do the same. */
export function LineChart({ data, name, format, currency, height = 220, label }: { data: Point[]; name: string; format: (v: number) => string; currency?: string; height?: number; label: string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 52, r: 72, t: 14, b: 28 }; // right margin leaves room for the end-point label, clear of the line
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const fmtTick = tickFormatter(top, currency);
  const n = data.length;
  const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.t + ih - (v / top) * ih;
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = n ? `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const xLabels = n <= 1 ? [0] : Array.from(new Set([0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1]));
  const last = n - 1;

  function nearest(clientX: number, el: SVGSVGElement) {
    const px = clientX - el.getBoundingClientRect().left;
    const i = Math.round(((px - m.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const hp = hover !== null ? data[hover] : null;
  return (
    <div ref={ref} className="relative w-full min-w-0 [contain:inline-size]" style={{ minHeight: height }}>
      <svg width={width} height={height} tabIndex={0} role="group" aria-label={`${label}. ${n} days. Use left and right arrow keys to read values.`}
        onPointerMove={(e) => nearest(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}
        onFocus={() => setHover((h) => h ?? last)} onBlur={() => setHover(null)}
        onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? last) - 1)); } if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(last, (h ?? last) + 1)); } if (e.key === "Escape") setHover(null); }}
        className="block overflow-visible rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} strokeWidth={1} />
            <text x={m.l - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>{fmtTick(t)}</text>
          </g>
        ))}
        {xLabels.map((i) => (
          <text key={i} x={x(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === last ? "end" : "middle"} fontSize={11} fill="var(--viz-muted)">{data[i] && shortDate(data[i].date)}</text>
        ))}
        {n > 0 && <path d={area} fill="var(--viz-s1)" opacity={0.1} />}
        {n > 0 && <path d={line} fill="none" stroke="var(--viz-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {hp && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} />}
        {n > 0 && (() => { const i = hover ?? last; return <circle cx={x(i)} cy={y(data[i].value)} r={4} fill="var(--viz-s1)" stroke="var(--viz-surface)" strokeWidth={2} />; })()}
        {n > 0 && hover === null && <text x={x(last) + 10} y={y(data[last].value)} dy="0.32em" textAnchor="start" fontSize={12} fontWeight={600} fill="var(--viz-ink)">{format(data[last].value)}</text>}
      </svg>
      {hp && hover !== null && <Tooltip x={x(hover)} y={y(hp.value) - 20} width={width} title={longDate(hp.date)} rows={[{ key: <LineKey />, value: format(hp.value), name }]} />}
    </div>
  );
}
