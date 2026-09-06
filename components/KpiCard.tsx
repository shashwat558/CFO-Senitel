export function KpiCard({
  label,
  value,
  delta,
  deltaTone,
  tag,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "pos" | "neg" | "neutral";
  tag?: string;
}) {
  return (
    <div className="telemetry-cell font-mono">
      <div className="telemetry-label">
        <span>{label}</span>
        {tag ? <span>{tag}</span> : null}
      </div>
      <div
        className="telemetry-value"
        style={deltaTone === "neg" ? { color: "var(--lp-red)" } : undefined}
      >
        {value}
      </div>
      {delta ? (
        <div
          className="telemetry-sub"
          style={{
            color:
              deltaTone === "pos"
                ? "var(--lp-green)"
                : deltaTone === "neg"
                ? "var(--lp-red)"
                : "var(--lp-fg-muted)",
          }}
        >
          {delta}
        </div>
      ) : (
        <div className="telemetry-sub" style={{ color: "var(--lp-fg-subtle)" }}>
          &mdash;
        </div>
      )}
    </div>
  );
}
