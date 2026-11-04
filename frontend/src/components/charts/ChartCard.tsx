"use client";

import { useState, type ReactNode } from "react";

/** Card chrome + the Chart/Table twin every chart must offer (tooltips never gate values). */
export function ChartCard({ title, subtitle, loading, chart, table }: { title: string; subtitle?: string; loading?: boolean; chart: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const tab = (v: "chart" | "table", text: string) => (
    <button type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
      className={`rounded px-2 py-1 text-xs font-medium ${view === v ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>{text}</button>
  );
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-[var(--viz-surface)] p-5" style={{ borderColor: "rgba(11,11,11,0.10)" }}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold" style={{ color: "var(--viz-ink)" }}>{title}</h2>{subtitle && <p className="text-xs" style={{ color: "var(--viz-ink-2)" }}>{subtitle}</p>}</div>
        <div role="tablist" aria-label={`${title} view`} className="flex gap-1">{tab("chart", "Chart")}{tab("table", "Table")}</div>
      </div>
      {/* Refetch keeps the frame: the previous render stays, dimmed, until new data arrives. */}
      <div className={`transition-opacity ${loading ? "opacity-50" : "opacity-100"}`} aria-busy={loading}>
        {view === "chart" ? chart : <div className="max-h-64 overflow-auto">{table}</div>}
      </div>
    </section>
  );
}
