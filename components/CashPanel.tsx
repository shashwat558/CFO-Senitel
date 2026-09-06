"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fmtSignedUSD, fmtUSD } from "@/lib/format";
import { useToast } from "@/components/Toasts";

interface CashWeek {
  weekStart: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
}

interface ForecastResp {
  weeks: CashWeek[];
  opening: number;
  minBalance: number;
  minWeekStart: string;
  requiredMinimum: number;
  shortfall: number;
  drivers: Array<{ label: string; kind: string; amount: number }>;
}

interface AgingResp {
  totals: Record<string, number>;
  total: number;
  rows: Array<{ invoiceNumber: string; counterparty: string; daysOverdue: number; total: number; bucket: string }>;
}

function sparkPath(values: number[], w: number, h: number, pad: number, floor: number): { line: string; area: string; breachY: number | null } {
  const min = Math.min(...values, floor);
  const max = Math.max(...values, floor);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = values.map((v, i) => ({ x: pad + i * stepX, y: y(v) }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `${line} L${(pad + (values.length - 1) * stepX).toFixed(1)},${(h - pad).toFixed(1)} L${pad},${(h - pad).toFixed(1)} Z`;
  return { line, area, breachY: y(floor) };
}

const W = 720;
const H = 180;
const PAD = 28;

export function CashPanel() {
  const [fc, setFc] = useState<ForecastResp | null>(null);
  const [ar, setAr] = useState<AgingResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const load = useCallback(async () => {
    try {
      const [fr, ar_] = await Promise.all([
        fetch("/api/cash/forecast?weeks=13"),
        fetch("/api/cash/aging?side=ar"),
      ]);
      const fj = await fr.json();
      const aj = await ar_.json();
      if (!fr.ok) throw new Error(fj.error ?? "forecast failed");
      if (!ar_.ok) throw new Error(aj.error ?? "aging failed");
      setFc(fj);
      setAr(aj);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "cash panel failed";
      setError(msg);
      push(msg, "error");
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="error-banner font-mono" style={{ marginBottom: 24 }}>
        <strong>CASH TELEMETRY ERROR:</strong> {error}
      </div>
    );
  }
  if (!fc || !ar) {
    return (
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// 13-WEEK CASH FORECAST</span>
          <span className="telemetry-chip font-mono">LOADING…</span>
        </div>
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const balances = fc.weeks.map((w) => w.balance);
  const { line, area, breachY } = sparkPath(balances, W, H, PAD, fc.requiredMinimum);
  const buckets: Array<[string, string]> = [
    ["current", "CURRENT"],
    ["1-30", "1–30D"],
    ["31-60", "31–60D"],
    ["61-90", "61–90D"],
    ["90+", "90D+"],
  ];

  return (
    <>
      {fc.shortfall > 0 ? (
        <div className="anomaly-alert-box" style={{ marginBottom: 24 }}>
          <div className="anomaly-alert-inner">
            <div className="anomaly-header font-mono">
              <span className="badge-tag critical">CASH BREACH PROJECTED</span>
              <span className="anomaly-code">COVENANT // ${Math.round(fc.requiredMinimum).toLocaleString()} FLOOR</span>
            </div>
            <h2 className="anomaly-title">
              Minimum <span>{fmtUSD(fc.minBalance)}</span> · shortfall <span>{fmtUSD(fc.shortfall)}</span>
            </h2>
            <p className="anomaly-body font-mono">
              TROUGH WEEK OF {fc.minWeekStart.slice(0, 10)} · TOP DRIVER: {fc.drivers[0]?.label ?? "—"} ({fc.drivers[0] ? fmtUSD(fc.drivers[0].amount) : ""})
            </p>
            <div className="anomaly-cta">
              <Link href="/incidents" className="btn-console-enter font-mono">
                OPEN CASH DOSSIER &rarr;
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <div className="spec-table-container" style={{ marginBottom: 24 }}>
        <div className="spec-table-header">
          <div className="spec-table-title font-mono">
            <span>// 13-WEEK CASH TRAJECTORY</span>
            <span className="spec-table-subtitle">
              OPENING {fmtUSD(fc.opening)} · MIN {fmtUSD(fc.minBalance)} · FLOOR {fmtUSD(fc.requiredMinimum)}
            </span>
          </div>
          <span className="telemetry-chip font-mono">SVG · ZERO-DEPS</span>
        </div>
        <div style={{ padding: "20px 24px", background: "#fff" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={180} role="img" aria-label="13-week cash balance chart">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="#eef2f7" strokeWidth={1} />
            ))}
            {breachY !== null ? (
              <line x1={PAD} x2={W - PAD} y1={breachY} y2={breachY} stroke="#e11d48" strokeWidth={1.5} strokeDasharray="6 4" />
            ) : null}
            <path d={area} fill="rgba(217, 119, 6, 0.12)" stroke="none" />
            <path d={line} fill="none" stroke="#000" strokeWidth={2.5} />
          </svg>
          <div className="font-mono muted" style={{ fontSize: 11, marginTop: 8 }}>
            DASHED RED = COVENANT FLOOR · BLACK = PROJECTED BALANCE · WEEKLY NET:{" "}
            {fc.weeks.slice(0, 4).map((w) => fmtSignedUSD(w.net)).join(" / ")}…
          </div>
        </div>
      </div>

      <div className="dossier-panel" style={{ marginBottom: 24 }}>
        <div className="dossier-header">
          <span className="dossier-title">// RECEIVABLES AGING — {fmtUSD(ar.total)} OUTSTANDING</span>
          <span className="telemetry-chip font-mono">SENT + OVERDUE</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {buckets.map(([key, label]) => (
            <span key={key} className="telemetry-chip font-mono">
              {label}: {fmtUSD(ar.totals[key] ?? 0)}
            </span>
          ))}
        </div>
        <div className="font-mono" style={{ fontSize: 11 }}>
          {ar.rows.slice(0, 5).map((r) => (
            <div key={r.invoiceNumber} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid var(--lp-border)" }}>
              <code className="inline">{r.invoiceNumber}</code>
              <span style={{ flex: 1 }}>{r.counterparty}</span>
              <span className="muted">{r.daysOverdue}d OVERDUE</span>
              <strong>{fmtUSD(r.total)}</strong>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
