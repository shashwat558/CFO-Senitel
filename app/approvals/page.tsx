"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Incident {
  id: string;
  title: string;
  status: string;
  severity?: string;
  type?: string;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/incidents?status=PENDING_APPROVAL")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setItems(j.items ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Header Stage */}
      <div className="page-header-stage">
        <div className="section-eyebrow font-mono">
          GOVERNANCE &amp; COMPLIANCE // DUAL-CONTROL ARCHITECTURE
        </div>
        <h1 className="page-title">
          ACTION APPROVALS
          <span className="serif-accent">human verification queue</span>
        </h1>
        <p className="page-sub font-mono">
          // Consequential financial actions require explicit human authorization · Deterministic arithmetic simulation before dispatch
        </p>
      </div>

      {error ? (
        <div className="error-banner font-mono" style={{ marginBottom: 24 }}>
          <strong>GOVERNANCE ENGINE ERROR:</strong> {error}
        </div>
      ) : null}

      {/* Governance Invariant Box */}
      <div className="anomaly-alert-box" style={{ marginBottom: 32 }}>
        <div className="anomaly-alert-inner">
          <div className="anomaly-header font-mono">
            <span className="badge-tag" style={{ background: "#f8fafc", borderColor: "var(--lp-border)" }}>
              GOVERNANCE INVARIANT
            </span>
            <span className="anomaly-code">ENFORCE-HUMAN-SIG-V1</span>
          </div>
          <h2 className="anomaly-title" style={{ fontSize: "18px" }}>
            Autonomous agents cannot mutate external ledgers without <span>dual-key authorization</span>
          </h2>
          <p className="anomaly-body font-mono">
            Every proposed invoice credit, vendor renegotiation notice, or GL adjusting entry must be verified by a designated finance executive. The queue below isolates all pending actions awaiting confirmation.
          </p>
        </div>
      </div>

      {/* Approvals Queue Panel */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// PENDING APPROVAL QUEUE ({items.length})</span>
          <div className="telemetry-chip font-mono">
            <span className="beacon-dot" style={items.length === 0 ? { background: "#059669" } : { background: "#d97706" }} />
            <span>{items.length === 0 ? "QUEUE STATUS: CLEAR" : `${items.length} ACTION(S) AWAITING REVIEW`}</span>
          </div>
        </div>

        {loading ? (
          <div className="muted font-mono" style={{ padding: "24px 0" }}>
            POLLING GOVERNANCE QUEUE…
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "48px 24px" }}>
            <div className="section-eyebrow font-mono" style={{ justifyContent: "center" }}>
              ZERO PENDING INTERVENTIONS
            </div>
            <p className="muted font-mono" style={{ maxWidth: 520, margin: "10px auto 20px" }}>
              The approval queue is empty. When autonomous investigations propose contract amendments or invoice dispute actions, they will appear here for verification.
            </p>
            <Link href="/incidents" className="btn-secondary-hero font-mono">
              BROWSE ACTIVE INCIDENTS &rarr;
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((i) => (
              <div key={i.id} className="finding-card font-mono">
                <div className="finding-info">
                  <div className="finding-name">{i.title}</div>
                  <div className="muted" style={{ fontSize: "11px" }}>
                    INCIDENT ID: {i.id} · AWAITING DUAL-SIGNATURE
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="badge-tag pending_approval">PENDING APPROVAL</span>
                  <Link href={`/incidents/${i.id}`} className="btn-console-enter font-mono" style={{ padding: "6px 14px", fontSize: "10px" }}>
                    REVIEW INCIDENT &rarr;
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
