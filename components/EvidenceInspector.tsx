"use client";

import { useState } from "react";
import { useToast } from "@/components/Toasts";

export interface EvidenceItem {
  id: string;
  findingId: string | null;
  toolName: string;
  input: unknown;
  output: unknown;
  summary: string;
  occurredAt: string;
}

function JsonBlock({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return <span className="muted font-mono">—</span>;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="json-block">{text}</pre>;
}

export function EvidenceInspector({ evidence }: { evidence: EvidenceItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(evidence[0]?.id ?? null);
  const { push } = useToast();
  const selected = evidence.find((e) => e.id === selectedId) ?? null;

  if (evidence.length === 0) {
    return (
      <p className="font-mono muted" style={{ fontSize: "12px" }}>
        No evidence records logged yet. Every agent tool invocation writes immutable evidence here.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <div style={{ border: "1px solid var(--lp-border)", background: "#fff", maxHeight: 420, overflow: "auto" }}>
        {evidence.map((e) => (
          <button
            key={e.id}
            onClick={() => {
              setSelectedId(e.id);
              if (!e.summary) push(`Evidence ${e.id.slice(0, 8)} has no summary`, "info");
            }}
            className="font-mono"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 14px",
              border: "none",
              borderBottom: "1px solid var(--lp-border)",
              background: e.id === selectedId ? "#f8fafc" : "#fff",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <code className="inline">{e.toolName}</code>{" "}
            <span style={{ color: "var(--lp-fg-muted)" }}>{e.summary?.slice(0, 80) || "—"}</span>
          </button>
        ))}
      </div>
      <div style={{ border: "1px solid var(--lp-border)", background: "#fafbfc", padding: 16, maxHeight: 420, overflow: "auto" }}>
        {selected ? (
          <div className="font-mono" style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <code className="inline">{selected.toolName}</code>
            </div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>
              OCCURRED AT: {new Date(selected.occurredAt).toLocaleString()}
            </div>
            <p style={{ color: "var(--lp-fg-muted)", lineHeight: 1.6 }}>{selected.summary || "—"}</p>
            <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", marginTop: 12 }}>TOOL INPUT</div>
            <JsonBlock value={selected.input} />
            <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", marginTop: 12 }}>TOOL OUTPUT</div>
            <JsonBlock value={selected.output} />
          </div>
        ) : (
          <span className="muted font-mono">Select an evidence trace.</span>
        )}
      </div>
    </div>
  );
}
