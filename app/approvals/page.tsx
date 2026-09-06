"use client";

import { ApprovalsQueue } from "@/components/ApprovalsQueue";

export default function ApprovalsPage() {
  return (
    <>
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

      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// PENDING APPROVAL QUEUE</span>
          <div className="telemetry-chip font-mono">T3 GOVERNANCE API</div>
        </div>
        <ApprovalsQueue />
      </div>
    </>
  );
}
