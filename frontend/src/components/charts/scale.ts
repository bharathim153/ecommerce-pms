/** Round-number axis ticks: 0, step, 2·step … covering max. */
export function niceTicks(max: number, target = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)) ?? 10 * mag;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** Full numbers under 10,000; compact above. One style per axis. */
export function tickFormatter(max: number, currency?: string) {
  const compact = max >= 10000;
  const nf = new Intl.NumberFormat("en-US", compact ? { notation: "compact", maximumFractionDigits: 1 } : { maximumFractionDigits: 2 });
  return (v: number) => {
    const n = nf.format(v);
    return currency ? (v === 0 ? "0" : new Intl.NumberFormat("en-US", { style: "currency", currency, notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 0 }).format(v)) : n;
  };
}

export function shortDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
export function longDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
