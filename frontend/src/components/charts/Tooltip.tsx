import type { ReactNode } from "react";

/** One readout. Value leads (strong), label follows (secondary); a short line-key identifies the series. */
export function Tooltip({ x, y, width, title, rows }: { x: number; y: number; width: number; title: string; rows: { key: ReactNode; value: string; name: string }[] }) {
  const flip = x > width * 0.6;
  return (
    <div role="status" className="pointer-events-none absolute z-10 min-w-36 rounded-md border bg-white px-3 py-2 text-xs shadow-md"
      style={{ left: x, top: Math.max(0, y), transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, 0)`, borderColor: "rgba(11,11,11,0.10)", color: "var(--viz-ink-2)" }}>
      <div className="mb-1">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          {r.key}
          <span className="text-sm font-semibold" style={{ color: "var(--viz-ink)" }}>{r.value}</span>
          <span>{r.name}</span>
        </div>
      ))}
    </div>
  );
}

export const LineKey = () => <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--viz-s1)" }} />;
