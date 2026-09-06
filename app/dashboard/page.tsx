"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
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
const YEAR_OPTIONS = [2024, 2025, 2026];
const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<number>(2024);

  const load = useCallback(async (y: number) => {
    try {
      const r = await fetch(`/api/dashboard?year=${y}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "dashboard failed");
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "dashboard failed");
    }
  }, []);

  useEffect(() => {
    load(year);
  }, [year, load]);

  if (error) {
    return (
      <div className="error-container">
        <div className="section-eyebrow font-mono">SYSTEM TELEMETRY // ERROR</div>
        <h1 className="page-title">DASHBOARD OFFLINE</h1>
        <div className="error-banner font-mono">
          <strong>DATABASE COMMUNICATION FAILURE:</strong> {error}
        </div>
        <p className="page-sub font-mono" style={{ marginTop: 16 }}>
          Verify PostgreSQL service and database migrations:
          <br />
          <code className="inline">docker compose up -d</code> then{" "}
          <code className="inline">npx prisma migrate dev && npx prisma db seed</code>
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="loading-container font-mono">
        <div className="section-eyebrow font-mono">TELEMETRY STREAM // INITIALIZING</div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" style={{ width: "40%" }} />
        <div className="skeleton-grid">
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
          <div className="skeleton skeleton-card" />
        </div>
      </div>
    );
  }

  const mom = data.monthOverMonth;
  const latestMonth = data.latest.month;
  const priorMonth = latestMonth - 1 >= 1 ? latestMonth - 1 : null;

  return (
    <>
      {/* Header Stage */}
      <div className="page-header-stage">
        <div className="section-eyebrow font-mono">
          GENERAL LEDGER TELEMETRY // {data.org.name.toUpperCase()}
        </div>
        <div className="dashboard-title-row">
          <h1 className="page-title">
            {data.org.name}
            <span className="serif-accent">financial telemetry</span>
          </h1>

          <div className="header-actions">
            <Link href="/incidents" className="btn-primary-hero font-mono" style={{ padding: "8px 18px" }}>
              VIEW INCIDENTS ({data.openIncidents}) &rarr;
            </Link>
          </div>
        </div>

        <p className="page-sub font-mono">
          // Authoritative double-entry GL ledger aggregate · Latest close: {MONTHS[data.latest.month]} {data.latest.year} · {data.openIncidents} open incident(s) · Deterministic arithmetic verified
        </p>
      </div>

      {/* Fiscal Year Filter Toolbar */}
      <div className="filter-toolbar font-mono">
        <div className="filter-group">
          <span className="filter-label">FISCAL YEAR:</span>
          <div className="lab-tabs">
            {YEAR_OPTIONS.map((y) => (
              <button
                key={y}
                className={`lab-tab-btn ${year === y ? "active" : ""}`}
                onClick={() => setYear(y)}
              >
                FY {y}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-meta">
          <div className="telemetry-chip font-mono">
            <span className="beacon-dot" />
            <span>{data.trend.length} MONTHS POSTED</span>
          </div>
        </div>
      </div>

      {/* KPI Telemetry Strip */}
      <div className="telemetry-strip font-mono" style={{ margin: "20px 0 32px" }}>
        <KpiCard
          label="Audited Revenue (Latest)"
          tag="USD"
          value={fmt$(data.latest.revenue)}
          delta={`${mom.revenueVariance >= 0 ? "+" : ""}${fmt$(mom.revenueVariance)} MoM`}
          deltaTone={mom.revenueVariance >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          label="COGS Expenditure"
          tag="USD"
          value={fmt$(data.latest.cogs)}
          delta={`${mom.cogsVariance >= 0 ? "+" : ""}${fmt$(mom.cogsVariance)} MoM`}
          deltaTone={mom.cogsVariance <= 0 ? "pos" : "neg"}
        />
        <KpiCard
          label="Gross Margin"
          tag="PERCENT"
          value={`${data.latest.grossMargin.toFixed(2)}%`}
          delta={`${mom.grossMarginVariance >= 0 ? "+" : ""}${mom.grossMarginVariance.toFixed(2)}pp MoM`}
          deltaTone={mom.grossMarginVariance >= 0 ? "pos" : "neg"}
        />
        <KpiCard
          label="Net Operating Income"
          tag="USD"
          value={fmt$(data.latest.netIncome)}
          delta="Audited Close"
          deltaTone="neutral"
        />
      </div>

      {/* August vs July Anomaly Alert Box */}
      {data.augustVsJuly && year === 2024 && (
        <div className="anomaly-alert-box">
          <div className="anomaly-alert-inner">
            <div className="anomaly-header font-mono">
              <span className="badge-tag critical">DETECTED ANOMALY</span>
              <span className="anomaly-code">ERR-2024-AUG-MARGIN</span>
            </div>
            <h2 className="anomaly-title">
              August gross margin contracted by{" "}
              <span>{Math.abs(data.augustVsJuly.variance).toFixed(2)} percentage points</span> vs July
            </h2>
            <p className="anomaly-body font-mono">
              July gross margin was {data.augustVsJuly.julyMargin.toFixed(2)}% vs August at {data.augustVsJuly.augustMargin.toFixed(2)}% ({data.augustVsJuly.variance.toFixed(2)}pp). The Investigator Agent can localize this variance across supplier contracts, invoices, and purchase orders.
            </p>
            <div className="anomaly-cta">
              <Link href="/incidents" className="btn-console-enter font-mono">
                INVESTIGATE APEX STEEL ANOMALY &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Trend Spec Table */}
      <div className="spec-table-container">
        <div className="spec-table-header">
          <div className="spec-table-title font-mono">
            <span>// MONTHLY PERFORMANCE LEDGER</span>
            <span className="spec-table-subtitle">FY {data.latest.year} P&amp;L AGGREGATE</span>
          </div>
          <span className="telemetry-chip font-mono">POSTGRES DOUBLE-ENTRY</span>
        </div>

        <div className="spec-table-box">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Revenue</th>
                <th>COGS</th>
                <th>Gross Profit</th>
                <th>Gross Margin</th>
                <th>Close Status</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((t) => {
                const isLatest = t.month === latestMonth;
                const isPrior = t.month === priorMonth;
                const isAnomaly = year === 2024 && t.month === 8;
                const cls = isAnomaly
                  ? "highlight-anomaly"
                  : isLatest
                  ? "highlight-latest"
                  : isPrior
                  ? "highlight-prior"
                  : "";

                return (
                  <tr key={t.month} className={cls}>
                    <td>
                      <span className="month-label font-mono">
                        {MONTHS[t.month]} {t.year}
                      </span>
                    </td>
                    <td>{fmt$(t.revenue)}</td>
                    <td>{fmt$(t.cogs)}</td>
                    <td>{fmt$(t.grossProfit)}</td>
                    <td>
                      <span
                        style={{
                          fontWeight: 700,
                          color: isAnomaly ? "var(--lp-red)" : "inherit",
                        }}
                      >
                        {t.grossMargin.toFixed(2)}%
                      </span>
                    </td>
                    <td>
                      {isAnomaly ? (
                        <span className="badge-tag critical">ANOMALY</span>
                      ) : isLatest ? (
                        <span className="badge-tag" style={{ background: "var(--lp-green-bg)", color: "var(--lp-green)", borderColor: "var(--lp-green-border)" }}>
                          LATEST CLOSE
                        </span>
                      ) : isPrior ? (
                        <span className="badge-tag" style={{ background: "var(--lp-amber-bg)", color: "var(--lp-amber)", borderColor: "var(--lp-amber-border)" }}>
                          PRIOR CLOSE
                        </span>
                      ) : (
                        <span className="badge-tag" style={{ background: "#f1f5f9", color: "var(--lp-fg-muted)", borderColor: "#e2e8f0" }}>
                          POSTED
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Vendors Table */}
      <div className="spec-table-container" style={{ marginTop: 36 }}>
        <div className="spec-table-header">
          <div className="spec-table-title font-mono">
            <span>// TOP SUPPLIER EXPENDITURES</span>
            <span className="spec-table-subtitle">
              LATEST MONTH TOTAL: {fmt$(data.totalSpendLatestMonth)}
            </span>
          </div>
          <span className="telemetry-chip font-mono">PROCURE-TO-PAY</span>
        </div>

        <div className="spec-table-box">
          <table>
            <thead>
              <tr>
                <th>Vendor / Counterparty</th>
                <th>Total Invoiced Spend</th>
                <th>Invoices Count</th>
                <th>Expenditure Share</th>
              </tr>
            </thead>
            <tbody>
              {data.topVendors.map((v) => {
                const sharePct = data.totalSpendLatestMonth > 0
                  ? ((v.totalSpend / data.totalSpendLatestMonth) * 100).toFixed(1)
                  : "0.0";
                return (
                  <tr key={v.vendorName}>
                    <td>
                      <strong>{v.vendorName}</strong>
                    </td>
                    <td>{fmt$(v.totalSpend)}</td>
                    <td>{v.invoiceCount}</td>
                    <td>
                      <div className="spend-share-cell font-mono">
                        <span>{sharePct}%</span>
                        <div className="spend-share-bar">
                          <div
                            className="spend-share-fill"
                            style={{ width: `${Math.min(100, Number(sharePct))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
