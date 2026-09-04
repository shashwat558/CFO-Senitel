export function KpiCard({
  label,
  value,
  delta,
  deltaTone,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "pos" | "neg";
}) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta ? <div className={deltaTone === "neg" ? "delta-neg" : "delta-pos"}>{delta}</div> : null}
    </div>
  );
}
