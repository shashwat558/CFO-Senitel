"use client";

import { useEffect, useState } from "react";
import { KpiCard } from "@/components/KpiCard";

interface TrendRow {
  year: number; month: number; revenue: number; cogs: number;
  grossProfit: number; grossMargin: number; netIncome: number;
}

interface DashboardResp {
  org: { id: string; name: string };
  latest: TrendRow;
  monthOverMonth: { grossMarginVariance: number; revenueVariance: number; cogsVariance: number };
  augustVsJuly: { augustMargin: number; julyMargin: number; variance: number } | null;
  trend: TrendRow[];
  topVendors: Array<{ vendorName: string; totalSpend: number; invoiceCount: number }>;
  totalSpendLatestMonth: number;
  openIncidents: number;
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "dashboard failed");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <h1>Dashboard</h1>
        <p className="error">{error}</p>
        <p className="muted">
          Is PostgreSQL running and seeded? <code className="inline">docker compose up -d</code> then{" "}
          <code className="inline">npx prisma migrate dev && npx prisma db seed</code>
        </p>
      </>
    );
  }
  if (!data) return <p className="muted">Loading dashboard…</p>;

  const mom = data.monthOverMonth;
  return (
    <>
      <h1>{data.org.name} — Dashboard</h1>
      <p className="sub">
        Latest close: {MONTHS[data.latest.month]} {data.latest.year} · {data.openIncidents} open
        incident(s) · Foundation phase: deterministic P&amp;L from posted GL lines.
      </p>

      <div className="grid">
        <KpiCard label="Revenue (latest)" value={fmt$(data.latest.revenue)} delta={`${mom.revenueVariance >= 0 ? "+" : ""}${fmt$(mom.revenueVariance)} MoM`} deltaTone={mom.revenueVariance >= 0 ? "pos" : "neg"} />
        <KpiCard label="COGS (latest)" value={fmt$(data.latest.cogs)} delta={`${mom.cogsVariance >= 0 ? "+" : ""}${fmt$(mom.cogsVariance)} MoM`} deltaTone={mom.cogsVariance <= 0 ? "pos" : "neg"} />
        <KpiCard label="Gross margin" value={`${data.latest.grossMargin.toFixed(2)}%`} delta={`${mom.grossMarginVariance >= 0 ? "+" : ""}${mom.grossMarginVariance.toFixed(2)}pp MoM`} deltaTone={mom.grossMarginVariance >= 0 ? "pos" : "neg"} />
        <KpiCard label="Net income" value={fmt$(data.latest.netIncome)} />
      </div>

      {data.augustVsJuly && (
        <div className="panel">
          <h2>August vs July gross margin (demo question)</h2>
          <p className="muted">
            July {data.augustVsJuly.julyMargin.toFixed(2)}% → August{" "}
            {data.augustVsJuly.augustMargin.toFixed(2)}% (
            {data.augustVsJuly.variance >= 0 ? "+" : ""}
            {data.augustVsJuly.variance.toFixed(2)}pp). Phase 2 will let the Investigator Agent
            explain this from vendor spend and contract prices.
          </p>
        </div>
      )}

      <div className="panel">
        <h2>2024 monthly trend</h2>
        <table>
          <thead>
            <tr><th>Month</th><th>Revenue</th><th>COGS</th><th>Gross profit</th><th>Margin</th></tr>
          </thead>
          <tbody>
            {data.trend.map((t) => (
              <tr key={t.month} className={t.month === 8 ? "highlight" : ""}>
                <td>{MONTHS[t.month]}</td>
                <td>{fmt$(t.revenue)}</td>
                <td>{fmt$(t.cogs)}</td>
                <td>{fmt$(t.grossProfit)}</td>
                <td>{t.grossMargin.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Top vendors — latest month ({fmt$(data.totalSpendLatestMonth)} total)</h2>
        <table>
          <thead>
            <tr><th>Vendor</th><th>Spend</th><th>Invoices</th></tr>
          </thead>
          <tbody>
            {data.topVendors.map((v) => (
              <tr key={v.vendorName}>
                <td>{v.vendorName}</td>
                <td>{fmt$(v.totalSpend)}</td>
                <td>{v.invoiceCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
