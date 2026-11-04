"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ChartCard } from "@/components/charts/ChartCard";
import { ColumnChart } from "@/components/charts/ColumnChart";
import { HBarChart } from "@/components/charts/HBarChart";
import { LineChart } from "@/components/charts/LineChart";
import { shortDate } from "@/components/charts/scale";
import { Spinner } from "@/components/ui";
import { api, parseError, type ApiEnvelope } from "@/lib/api";
import { money } from "@/lib/format";
import type { DashboardData } from "@/types";

const RANGES = [{ d: 7, label: "Last 7 days" }, { d: 30, label: "Last 30 days" }, { d: 90, label: "Last 90 days" }];
const BADGE: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-800", completed: "bg-emerald-100 text-emerald-800", pending: "bg-slate-100 text-slate-700", queued: "bg-slate-100 text-slate-700", draft: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800", sending: "bg-blue-100 text-blue-800", failed: "bg-red-100 text-red-800", refunded: "bg-amber-100 text-amber-800", cancelled: "bg-amber-100 text-amber-800",
};
const Badge = ({ s }: { s: string }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[s] ?? BADGE.pending}`}>{s}</span>;

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border bg-white p-5" style={{ borderColor: "rgba(11,11,11,0.10)" }}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border bg-white p-5" style={{ borderColor: "rgba(11,11,11,0.10)" }}>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{action}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => <th className={`px-2 py-2 text-xs font-medium text-slate-500 ${right ? "text-right" : "text-left"}`}>{children}</th>;
const Td = ({ children, right }: { children: ReactNode; right?: boolean }) => <td className={`px-2 py-2 ${right ? "text-right tabular-nums" : ""}`}>{children}</td>;
const MoreLink = ({ href, children }: { href: string; children: ReactNode }) => <Link href={href} className="text-xs text-indigo-600 hover:underline">{children}</Link>;

export function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.resolve().then(async () => {
      setLoading(true);
      try {
        const { data: r } = await api.get<ApiEnvelope<DashboardData>>("/admin/dashboard", { params: { days } });
        if (live) { setData(r.data); setError(""); }
      } catch (e) { if (live) setError(parseError(e).message); } finally { if (live) setLoading(false); }
    });
    return () => { live = false; };
  }, [days]);

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data) return <Spinner label="Loading dashboard" />;

  const cur = data.currency;
  const m = (v: number) => money(v, cur);
  const rev = data.series.map((s) => ({ date: s.date, value: s.revenue }));
  const ord = data.series.map((s) => ({ date: s.date, value: s.orders }));
  const t = data.totals;
  const rate = (s: number, a: number) => (a ? `${Math.round((s / a) * 100)}%` : "—");
  const rangeLabel = RANGES.find((r) => r.d === days)!.label.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <nav aria-label="Quick actions" className="flex flex-wrap gap-2 text-sm">
          {[["/admin/products/new", "Add product"], ["/admin/email/campaigns/new", "New campaign"], ["/admin/exports", "PDF exports"], ["/admin/payment-settings", "Payment settings"]].map(([h, l]) => (
            <Link key={h} href={h} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-800 hover:bg-slate-50">{l}</Link>
          ))}
        </nav>
      </div>

      {/* One filter row above everything it scopes. */}
      <div role="radiogroup" aria-label="Date range" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
        {RANGES.map((r) => (
          <button key={r.d} role="radio" aria-checked={days === r.d} onClick={() => setDays(r.d)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${days === r.d ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{r.label}</button>
        ))}
      </div>

      <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
        <div className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-xl border bg-white p-6 lg:col-span-2" style={{ borderColor: "rgba(11,11,11,0.10)" }}>
            <p className="text-sm text-slate-600">Total revenue</p>
            <p className="mt-1 text-5xl font-semibold tracking-tight text-slate-900" data-testid="hero-revenue">{m(t.revenue.total)}</p>
            <p className="mt-2 text-sm text-slate-600"><span className="font-medium text-slate-900">{m(t.revenue.period)}</span> in the {rangeLabel}</p>
          </div>
          <Tile label="Orders" value={t.orders.total.toLocaleString()} sub={`${t.orders.new} in the ${rangeLabel} · ${t.orders.paid} paid overall`} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <Tile label="Customers" value={t.customers.total.toLocaleString()} sub={`${t.customers.new} new in the ${rangeLabel}`} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile label="Products" value={t.products.total.toLocaleString()} sub={`${t.products.published} published · ${t.products.new} new`} />
          <Tile label="Subscribers" value={data.campaigns.subscribers.subscribed.toLocaleString()} sub={`${data.campaigns.subscribers.unsubscribed} unsubscribed`} />
          <Tile label="Emails sent" value={data.campaigns.sent.toLocaleString()} sub={`${data.campaigns.created} campaign${data.campaigns.created === 1 ? "" : "s"} in the ${rangeLabel}`} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Revenue per day" subtitle={`Paid orders, ${rangeLabel}`} loading={loading}
            chart={<LineChart data={rev} name="Revenue" format={m} currency={cur} label="Revenue per day" />}
            table={<table className="w-full text-sm"><thead><tr><Th>Date</Th><Th right>Revenue</Th></tr></thead><tbody>{rev.map((r) => <tr key={r.date} className="border-t border-slate-100"><Td>{shortDate(r.date)}</Td><Td right>{m(r.value)}</Td></tr>)}</tbody></table>} />
          <ChartCard title="Paid orders per day" subtitle={rangeLabel[0].toUpperCase() + rangeLabel.slice(1)} loading={loading}
            chart={<ColumnChart data={ord} name="Orders" format={(v) => String(v)} label="Paid orders per day" />}
            table={<table className="w-full text-sm"><thead><tr><Th>Date</Th><Th right>Orders</Th></tr></thead><tbody>{ord.map((r) => <tr key={r.date} className="border-t border-slate-100"><Td>{shortDate(r.date)}</Td><Td right>{r.value}</Td></tr>)}</tbody></table>} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Orders by status" subtitle={`Created in the ${rangeLabel}`} loading={loading}
            chart={<HBarChart data={data.orders_by_status.map((s) => ({ label: s.status, value: s.count }))} unit="orders" label="Orders by status" />}
            table={<table className="w-full text-sm"><thead><tr><Th>Status</Th><Th right>Orders</Th></tr></thead><tbody>{data.orders_by_status.map((s) => <tr key={s.status} className="border-t border-slate-100"><Td><Badge s={s.status} /></Td><Td right>{s.count}</Td></tr>)}</tbody></table>} />
          <Card title="Payments" action={<MoreLink href="/admin/orders">All orders</MoreLink>}>
            <table className="w-full text-sm"><thead><tr><Th>Provider</Th><Th right>Attempts</Th><Th right>Succeeded</Th><Th right>Failed</Th><Th right>Success rate</Th><Th right>Revenue</Th></tr></thead>
              <tbody>{data.payments.map((p) => (
                <tr key={p.provider} className="border-t border-slate-100"><Td><span className="font-medium">{p.provider === "paypal" ? "PayPal" : "Stripe"}</span></Td><Td right>{p.attempts}</Td><Td right>{p.succeeded}</Td><Td right>{p.failed}</Td><Td right>{rate(p.succeeded, p.attempts)}</Td><Td right>{m(p.revenue)}</Td></tr>))}</tbody></table>
            {data.payments.every((p) => p.attempts === 0) && <p className="mt-3 text-sm text-slate-500">No payment attempts in this period.</p>}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Recent orders" action={<MoreLink href="/admin/orders">View all</MoreLink>}>
            {data.recent_orders.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No orders yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Order</Th><Th>Customer</Th><Th>Status</Th><Th right>Total</Th></tr></thead>
                <tbody>{data.recent_orders.map((o) => <tr key={o.id} className="border-t border-slate-100"><Td><span className="font-mono text-xs">{o.number}</span></Td><Td>{o.customer}</Td><Td><Badge s={o.status} /></Td><Td right>{money(o.total, o.currency)}</Td></tr>)}</tbody></table>)}
          </Card>
          <Card title="Recent customers">
            {data.recent_customers.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No customers yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Name</Th><Th>Email</Th><Th>Joined</Th></tr></thead>
                <tbody>{data.recent_customers.map((c) => <tr key={c.id} className="border-t border-slate-100"><Td>{c.name}</Td><Td><span className="text-slate-600">{c.email}</span>{!c.verified && <span className="ml-2 text-xs text-amber-700">unverified</span>}</Td><Td>{new Date(c.created_at).toLocaleDateString()}</Td></tr>)}</tbody></table>)}
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="PDF export history" action={<MoreLink href="/admin/exports">Manage</MoreLink>}>
            {data.pdf_exports.recent.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No exports yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>#</Th><Th>Scope</Th><Th>Status</Th><Th right>Pages</Th><Th>Created</Th></tr></thead>
                <tbody>{data.pdf_exports.recent.map((e) => <tr key={e.id} className="border-t border-slate-100"><Td>{e.id}</Td><Td>{e.scope === "all" ? "All products" : `${e.total_products} selected`}</Td><Td><Badge s={e.status} /></Td><Td right>{e.page_count ?? "—"}</Td><Td>{new Date(e.created_at).toLocaleDateString()}</Td></tr>)}</tbody></table>)}
          </Card>
          <Card title="Email campaigns" action={<MoreLink href="/admin/email/campaigns">All campaigns</MoreLink>}>
            <dl className="mb-3 grid grid-cols-4 gap-2 text-center">
              {([["Sent", data.campaigns.sent], ["Delivered", data.campaigns.delivered], ["Failed", data.campaigns.failed], ["Bounced", data.campaigns.bounced]] as const).map(([l, v]) => (
                <div key={l} className="rounded-lg bg-slate-50 p-2"><dt className="text-xs text-slate-500">{l}</dt><dd className="text-lg font-semibold text-slate-900">{v.toLocaleString()}</dd></div>))}
            </dl>
            {data.campaigns.recent.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">No campaigns yet.</p> : (
              <table className="w-full text-sm"><thead><tr><Th>Subject</Th><Th>Status</Th><Th right>Sent</Th></tr></thead>
                <tbody>{data.campaigns.recent.map((c) => <tr key={c.id} className="border-t border-slate-100"><Td><Link href={`/admin/email/campaigns/${c.id}`} className="text-indigo-700 hover:underline">{c.subject}</Link></Td><Td><Badge s={c.status} /></Td><Td right>{c.sent}/{c.total_recipients}</Td></tr>)}</tbody></table>)}
          </Card>
        </div>
      </div>
    </div>
  );
}
