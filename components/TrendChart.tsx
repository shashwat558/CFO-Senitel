// Lightweight dependency-free SVG charts (no recharts / no new deps).
// Pure presentational components — no "use client", safe in RSC.

export interface TrendPoint {
  year: number;
  month: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
}

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function seriesPath(values: number[], w: number, h: number, pad: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((v - min) / span) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function TrendChart({ trend, anomalyMonth = 8 }: { trend: TrendPoint[]; anomalyMonth?: number }) {
  const W = 720;
  const H = 220;
  const PAD = 28;
  if (trend.length === 0) return <p className="font-mono muted">No trend data posted.</p>;
  const rev = trend.map((t) => t.revenue);
  const cogs = trend.map((t) => t.cogs);
  const margin = trend.map((t) => t.grossMargin);
  const stepX = trend.length > 1 ? (W - PAD * 2) / (trend.length - 1) : 0;
  return (
    <div className="spec-table-container" role="img" aria-label="Monthly performance chart">
      <div className="spec-table-header">
        <div className="spec-table-title font-mono">
          <span>// MONTHLY PERFORMANCE CHART</span>
          <span className="spec-table-subtitle">REVENUE · COGS · MARGIN</span>
        </div>
        <span className="telemetry-chip font-mono">SVG · ZERO-DEPS</span>
      </div>
      <div style={{ padding: "20px 24px", background: "#fff" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="220" aria-hidden="true">
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} stroke="#eef2f7" strokeWidth={1} />
          ))}
          <path d={seriesPath(rev, W, H, PAD)} fill="none" stroke="#000" strokeWidth={2.5} />
          <path d={seriesPath(cogs, W, H, PAD)} fill="none" stroke="#d97706" strokeWidth={2} strokeDasharray="6 4" />
          <path d={seriesPath(margin, W, H, PAD)} fill="none" stroke="#059669" strokeWidth={2} />
          {trend.map((t, i) => {
            const cx = PAD + i * stepX;
            const isAnomaly = t.month === anomalyMonth;
            return (
              <g key={`${t.year}-${t.month}`}>
                {isAnomaly ? (
                  <circle cx={cx} cy={14} r={5} fill="#e11d48">
                    <title>Anomaly</title>
                  </circle>
                ) : null}
                <text x={cx} y={H - 6} fontSize={10} textAnchor="middle" fill="#8a94a6" fontFamily="JetBrains Mono, monospace">
                  {MONTHS[t.month]}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="font-mono" style={{ display: "flex", gap: 20, fontSize: 11, marginTop: 8 }}>
          <span><i style={{ display: "inline-block", width: 18, height: 3, background: "#000", marginRight: 6 }} />REVENUE</span>
          <span><i style={{ display: "inline-block", width: 18, height: 3, background: "#d97706", marginRight: 6 }} />COGS</span>
          <span><i style={{ display: "inline-block", width: 18, height: 3, background: "#059669", marginRight: 6 }} />MARGIN %</span>
        </div>
      </div>
    </div>
  );
}

export function VendorBarChart({
  vendors,
  total,
}: {
  vendors: Array<{ vendorName: string; totalSpend: number; invoiceCount: number }>;
  total: number;
}) {
  if (vendors.length === 0) return <p className="font-mono muted">No vendor spend posted.</p>;
  const max = Math.max(...vendors.map((v) => v.totalSpend), 1);
  const W = 720;
  const ROW_H = 34;
  const H = vendors.length * ROW_H + 10;
  return (
    <div className="spec-table-container" style={{ marginTop: 24 }} role="img" aria-label="Vendor spend chart">
      <div className="spec-table-header">
        <div className="spec-table-title font-mono">
          <span>// SUPPLIER EXPENDITURE CHART</span>
        </div>
        <span className="telemetry-chip font-mono">SVG · ZERO-DEPS</span>
      </div>
      <div style={{ padding: "16px 24px 20px", background: "#fff" }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true">
          {vendors.map((v, i) => {
            const bw = Math.max(4, ((v.totalSpend / max) * (W - 260)));
            const y = 8 + i * ROW_H;
            return (
              <g key={v.vendorName}>
                <text x={0} y={y + 14} fontSize={11} fill="#0a0e14" fontFamily="JetBrains Mono, monospace">
                  {v.vendorName.slice(0, 22)}
                </text>
                <rect x={200} y={y} width={bw} height={16} fill="#000" />
                <text x={208 + bw} y={y + 13} fontSize={10} fill="#525a66" fontFamily="JetBrains Mono, monospace">
                  {total > 0 ? ((v.totalSpend / total) * 100).toFixed(1) : "0.0"}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
