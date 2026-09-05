"use client";

import Link from "next/link";
import { useState } from "react";

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<"AUG_MARGIN" | "APEX_OVERCHARGE" | "PO_VARIANCE">("AUG_MARGIN");

  return (
    <div className="landing-root">
      <div className="hairline-grid-y" aria-hidden="true" />

      {/* Top Architectural Header */}
      <header className="sentinel-topbar">
        <div className="sentinel-topbar-inner">
          <Link href="/" className="brand-emblem-wrap">
            <div className="brand-emblem">∑</div>
            <div className="brand-wordmark">CFO SENTINEL</div>
          </Link>

          <nav className="topbar-nav font-mono">
            <a href="#forensics">INCIDENT FORENSICS</a>
            <a href="#deterministic">DETERMINISTIC ENGINE</a>
            <a href="#lineage">PROCURE-TO-PAY</a>
            <a href="#specifications">SYSTEM SPECS</a>
          </nav>

          <div className="topbar-telemetry">
            <div className="telemetry-chip font-mono">
              <span className="beacon-dot" />
              <span>POSTGRES GL // 0.0ms DRIFT</span>
            </div>
            <Link href="/dashboard" className="btn-console-enter font-mono">
              LAUNCH CONSOLE <span style={{ fontSize: "12px" }}>&rarr;</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-stage">
        {/* Intricate Architectural Geometry & Financial Coordinate Vectors */}
        <div className="hero-vector-backdrop" aria-hidden="true">
          <svg
            viewBox="0 0 800 800"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: "100%", height: "100%" }}
          >
            {/* Outer Concentric Nested Geometric Circles & Hairlines */}
            <circle cx="400" cy="400" r="380" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 6" />
            <circle cx="400" cy="400" r="280" stroke="#cbd5e1" strokeWidth="1" />
            <circle cx="400" cy="400" r="160" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="2 4" />
            <circle cx="400" cy="400" r="8" stroke="#000" strokeWidth="2" fill="#fff" />

            {/* Precision Wireframe Polygons (Octagon + Nested Polyhedra) */}
            <polygon
              points="400,60 640,160 740,400 640,640 400,740 160,640 60,400 160,160"
              stroke="#cbd5e1"
              strokeWidth="1.2"
            />
            <polygon
              points="400,120 600,200 680,400 600,600 400,680 200,600 120,400 200,200"
              stroke="#94a3b8"
              strokeWidth="1.4"
            />
            <polygon
              points="200,200 600,200 400,680"
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="6 6"
            />
            <polygon
              points="200,600 600,600 400,120"
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="6 6"
            />

            {/* Mathematical Axis Lines & Crosshair Markers */}
            <line x1="400" y1="20" x2="400" y2="780" stroke="#e2e8f0" strokeWidth="1" />
            <line x1="20" y1="400" x2="780" y2="400" stroke="#e2e8f0" strokeWidth="1" />
            <line x1="130" y1="130" x2="670" y2="670" stroke="#f1f5f9" strokeWidth="1.5" strokeDasharray="3 3" />
            <line x1="130" y1="670" x2="670" y2="130" stroke="#f1f5f9" strokeWidth="1.5" strokeDasharray="3 3" />

            {/* Forensic Nodes & Registration Ticks */}
            <circle cx="640" cy="160" r="4" fill="#059669" />
            <circle cx="160" cy="640" r="4" fill="#e11d48" />
            <circle cx="640" cy="640" r="4" fill="#000" />
            <circle cx="160" cy="160" r="4" fill="#000" />
            <circle cx="400" cy="120" r="3" fill="#64748b" />
            <circle cx="400" cy="680" r="3" fill="#64748b" />
            <circle cx="120" cy="400" r="3" fill="#64748b" />
            <circle cx="680" cy="400" r="3" fill="#64748b" />
          </svg>
        </div>

        <div className="hero-meta-badge font-mono">
          <span className="beacon-dot" />
          <span>AUTONOMOUS FINANCIAL FORENSICS ENGINE V2.0</span>
        </div>

        <h1 className="hero-main-title">
          THE LEDGER NEVER LIES.
          <span className="hero-serif-accent">neither do our agents.</span>
        </h1>

        <p className="hero-lead-text font-mono">
          // CFO Sentinel deploys deterministic AI investigators across your general ledger, purchase orders, and supplier contracts. Uncovering margin degradation, invoice overcharges, and ledger drift before month-end close.
        </p>

        <div className="hero-cta-group">
          <Link href="/incidents" className="btn-primary-hero font-mono">
            INVESTIGATE INCIDENTS <span style={{ fontSize: "12px" }}>&#8599;</span>
          </Link>
          <Link href="/dashboard" className="btn-secondary-hero font-mono">
            EXPLORE P&amp;L DASHBOARD <span style={{ fontSize: "11px" }}>&#9638;</span>
          </Link>
        </div>

        {/* Live Seeded Telemetry Strip */}
        <div className="telemetry-strip font-mono">
          <div className="telemetry-cell">
            <div className="telemetry-label">
              <span>AUDITED REVENUE (2024)</span>
              <span>USD</span>
            </div>
            <div className="telemetry-value">$14,730,000</div>
            <div className="telemetry-sub" style={{ color: "#059669" }}>
              +0.42% MoM Base Index
            </div>
          </div>

          <div className="telemetry-cell">
            <div className="telemetry-label">
              <span>AUGUST GROSS MARGIN</span>
              <span>ACME</span>
            </div>
            <div className="telemetry-value" style={{ color: "#e11d48" }}>
              27.58%
            </div>
            <div className="telemetry-sub" style={{ color: "#e11d48" }}>
              -4.82pp vs July (32.40%)
            </div>
          </div>

          <div className="telemetry-cell">
            <div className="telemetry-label">
              <span>LEDGER INVARIANT</span>
              <span>POSTGRES</span>
            </div>
            <div className="telemetry-value">100.00%</div>
            <div className="telemetry-sub" style={{ color: "#059669" }}>
              Balanced: Debits == Credits
            </div>
          </div>

          <div className="telemetry-cell">
            <div className="telemetry-label">
              <span>IDENTIFIED LEAKAGE</span>
              <span>AUDIT</span>
            </div>
            <div className="telemetry-value" style={{ color: "#d97706" }}>
              $48,750
            </div>
            <div className="telemetry-sub">
              Apex Steel Unit Price Delta
            </div>
          </div>
        </div>
      </section>

      {/* The Iron Rule Callout */}
      <section className="iron-rule-section" id="deterministic">
        <div className="iron-rule-box">
          <div className="iron-rule-tag font-mono">THE DETERMINISTIC INVARIANT</div>
          <h2 className="iron-rule-quote">
            &ldquo;The LLM never calculates authoritative numbers. <span>The agent hypothesizes; only deterministic services compute truth.&rdquo;</span>
          </h2>
          <p className="iron-rule-desc">
            Unlike probabilistic copilot tools that hallucinate mathematical calculations, CFO Sentinel enforces an unbreachable architecture: Agent reasoning triggers Zod-validated financial tools, which execute pure TypeScript arithmetic against authoritative PostgreSQL double-entry journal transactions.
          </p>

          <div className="flow-step-chain font-mono">
            <div className="flow-node">AGENT REASONING</div>
            <div style={{ color: "#64748b" }}>&rarr;</div>
            <div className="flow-node highlight">ZOD SCHEMA VALIDATION</div>
            <div style={{ color: "#64748b" }}>&rarr;</div>
            <div className="flow-node">DETERMINISTIC P&amp;L SERVICE</div>
            <div style={{ color: "#64748b" }}>&rarr;</div>
            <div className="flow-node highlight">POSTGRESQL AUDIT LOG</div>
            <div style={{ color: "#64748b" }}>&rarr;</div>
            <div className="flow-node">CRYPTOGRAPHIC EVIDENCE</div>
          </div>
        </div>
      </section>

      {/* Forensic Incident Lab (Interactive Case Study) */}
      <section className="lab-section" id="forensics">
        <div className="section-eyebrow">CASE STUDY // REAL INVESTIGATION RUNTIME</div>

        <div className="lab-title-row">
          <h2 className="lab-heading">
            ANATOMY OF AN <span>incident traversal</span>
          </h2>

          <div className="lab-tabs font-mono">
            <button
              onClick={() => setActiveTab("AUG_MARGIN")}
              className={`lab-tab-btn ${activeTab === "AUG_MARGIN" ? "active" : ""}`}
            >
              [1] MARGIN COLLAPSE
            </button>
            <button
              onClick={() => setActiveTab("APEX_OVERCHARGE")}
              className={`lab-tab-btn ${activeTab === "APEX_OVERCHARGE" ? "active" : ""}`}
            >
              [2] APEX STEEL SURCHARGE
            </button>
            <button
              onClick={() => setActiveTab("PO_VARIANCE")}
              className={`lab-tab-btn ${activeTab === "PO_VARIANCE" ? "active" : ""}`}
            >
              [3] CONTRACT RECONCILIATION
            </button>
          </div>
        </div>

        {/* Live Forensics Console */}
        <div className="forensics-console font-mono">
          <div className="console-header-bar">
            <div className="console-header-left">
              <div className="window-pills">
                <div className="window-pill" />
                <div className="window-pill" />
                <div className="window-pill" />
              </div>
              <span>INCIDENT #INC-2024-08-01 // DETECTED VIA SCHEDULED GL DRIFT SWEEP</span>
            </div>
            <span>RUN_ID: run_9281fca · CONFIDENCE: 0.99</span>
          </div>

          <div className="console-grid-layout">
            {/* Left summary pane */}
            <div className="console-left-pane">
              <div className="incident-card-preview">
                <div className="incident-badge-row">
                  <span className="badge-tag critical">CRITICAL SEVERITY</span>
                  <span className="badge-tag investigating">RESOLVED PROOF</span>
                </div>
                <div style={{ fontSize: "13px", fontWeight: "800", color: "#000", marginBottom: "8px" }}>
                  August 2024 Gross Margin Degradation
                </div>
                <div style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.6" }}>
                  Gross profit fell by 4.82 percentage points month-over-month despite stable top-line sales volume of $1,235,000.
                </div>
              </div>

              <div style={{ fontSize: "11px", color: "#334155", marginTop: "20px" }}>
                <div style={{ fontWeight: "700", marginBottom: "8px", textTransform: "uppercase" }}>Key Findings</div>
                <div style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0" }}>
                  &bull; COGS increased +$78,400 in August
                </div>
                <div style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0" }}>
                  &bull; Raw Materials (Acct 5000) drove 92% of surge
                </div>
                <div style={{ padding: "8px 0", borderTop: "1px solid #e2e8f0", color: "#e11d48", fontWeight: "600" }}>
                  &bull; Apex Steel invoiced +28.0% over contract unit price ($1,088 vs $850/ton)
                </div>
              </div>
            </div>

            {/* Right Forensic Traversal Log */}
            <div className="console-right-pane">
              {activeTab === "AUG_MARGIN" && (
                <div>
                  <div className="traversal-step">
                    <div className="traversal-node-dot" />
                    <div className="step-tool-call">STEP 1: getPnl({`{ year: 2024, month: 8 }`})</div>
                    <div className="step-tool-desc">
                      Agent extracts deterministic P&amp;L statement from balanced posted transactions.
                    </div>
                    <div className="step-evidence-snippet">
                      Revenue: $1,235,000 | COGS: $894,390 | Gross Profit: $340,610 | Margin: 27.58%
                    </div>
                  </div>

                  <div className="traversal-step">
                    <div className="traversal-node-dot" />
                    <div className="step-tool-call">STEP 2: comparePeriods(periodA: 7, periodB: 8, year: 2024)</div>
                    <div className="step-tool-desc">
                      Agent executes variance analysis against prior clean baseline period.
                    </div>
                    <div className="step-evidence-snippet">
                      July Margin: 32.40% &rarr; August: 27.58% (Delta: -4.82pp / COGS Variance: +$78,400)
                    </div>
                  </div>

                  <div className="traversal-step">
                    <div className="traversal-node-dot success" />
                    <div className="step-tool-call">STEP 3: breakDownMetric(metric: "COGS", month: 8)</div>
                    <div className="step-tool-desc">
                      Deterministic breakdown of general ledger cost accounts.
                    </div>
                    <div className="step-evidence-snippet" style={{ borderLeftColor: "#059669" }}>
                      Account 5000 (Materials): $836,790 (+12.4% MoM) | Account 5010 (Freight): $57,600 (0.0% MoM)
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "APEX_OVERCHARGE" && (
                <div>
                  <div className="traversal-step">
                    <div className="traversal-node-dot" />
                    <div className="step-tool-call">STEP 4: getVendorSpend(month: 8, year: 2024)</div>
                    <div className="step-tool-desc">
                      Aggregates total disbursements and AP ledger lines by vendor.
                    </div>
                    <div className="step-evidence-snippet">
                      Apex Steel: $359,040 (42.9% of materials spend) | GLC: $150,000 | Pacific Plastics: $128,000
                    </div>
                  </div>

                  <div className="traversal-step">
                    <div className="traversal-node-dot success" />
                    <div className="step-tool-call">STEP 5: compareVendorPrices(vendorCode: "APEX", month: 8)</div>
                    <div className="step-tool-desc">
                      Cross-references invoiced unit price with signed Master Supply Contract.
                    </div>
                    <div className="step-evidence-snippet" style={{ borderLeftColor: "#e11d48", color: "#9f1239" }}>
                      Contract Price: $850.00/TON | August Invoiced Price: $1,088.00/TON | Deviation: +28.00%
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "PO_VARIANCE" && (
                <div>
                  <div className="traversal-step">
                    <div className="traversal-node-dot" />
                    <div className="step-tool-call">STEP 6: calculateFinancialImpact(vendorCode: "APEX", delta: 238, qty: 330)</div>
                    <div className="step-tool-desc">
                      Mathematical quantification of total unauthorized billing surcharge.
                    </div>
                    <div className="step-evidence-snippet" style={{ borderLeftColor: "#059669" }}>
                      Billed: $359,040 | Contracted Baseline: $280,500 | Overcharge Total: $78,540.00
                    </div>
                  </div>

                  <div className="traversal-step">
                    <div className="traversal-node-dot success" />
                    <div className="step-tool-call">STEP 7: recordEvidence() &rarr; PROPOSE ACTION</div>
                    <div className="step-tool-desc">
                      Causal link established. Proposed credit memo created awaiting Human Controller sign-off.
                    </div>
                    <div className="step-evidence-snippet" style={{ borderLeftColor: "#d97706" }}>
                      Action: HOLD_AP_PAYMENT_APEX &amp; ISSUE_CREDIT_MEMO_REQUEST ($78,540) &rarr; Status: PENDING_APPROVAL
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Procure-to-Pay Lineage Chain Map */}
      <section className="lab-section" id="lineage">
        <div className="section-eyebrow">DATA LINEAGE // CAUSAL GRAPH</div>
        <h2 className="lab-heading">
          END-TO-END <span>procure-to-pay traceability</span>
        </h2>
        <p style={{ color: "#64748b", fontSize: "14px", margin: "16px 0 28px", maxWidth: "680px" }}>
          Every finding generated by CFO Sentinel traces unbroken from the general ledger line back to the supplier contract clause.
        </p>

        <div className="chain-map-container font-mono">
          <div className="chain-steps-flex">
            <div className="chain-box">
              <div className="chain-step-num">01 / ENTITY</div>
              <div className="chain-step-name">VENDOR MASTER</div>
              <div className="chain-step-detail">Apex Steel Co (APEX) · Tier 1 Raw Materials</div>
            </div>

            <div className="chain-connector">&rarr;</div>

            <div className="chain-box">
              <div className="chain-step-num">02 / MASTER AGREEMENT</div>
              <div className="chain-step-name">CONTRACT CTR-01</div>
              <div className="chain-step-detail">Unit Price: $850/TON · Term: 2024-2026</div>
            </div>

            <div className="chain-connector">&rarr;</div>

            <div className="chain-box">
              <div className="chain-step-num">03 / COMMITMENT</div>
              <div className="chain-step-name">PURCHASE ORDER</div>
              <div className="chain-step-detail">PO-2024-08-330 · Qty: 330 TON Steel Coil</div>
            </div>

            <div className="chain-connector">&rarr;</div>

            <div className="chain-box flagged">
              <div className="chain-step-num" style={{ color: "#e11d48" }}>04 / ANOMALY POINT</div>
              <div className="chain-step-name" style={{ color: "#e11d48" }}>INVOICE INV-8821</div>
              <div className="chain-step-detail">Billed: $1,088/TON (+28% Unapproved Surcharge)</div>
            </div>

            <div className="chain-connector">&rarr;</div>

            <div className="chain-box">
              <div className="chain-step-num">05 / LEDGER EFFECT</div>
              <div className="chain-step-name">JOURNAL ENTRY</div>
              <div className="chain-step-detail">Dr 5000 (COGS) $359,040 / Cr 2000 (AP) $359,040</div>
            </div>
          </div>
        </div>
      </section>

      {/* Core Architectural Pillars */}
      <section className="pillars-section">
        <div className="section-eyebrow">FOUNDATION // THREE CORE PILLARS</div>
        <h2 className="lab-heading">
          ENGINEERED FOR <span>audit grade integrity</span>
        </h2>

        <div className="pillars-grid">
          <div className="pillar-card">
            <div>
              <div className="pillar-index font-mono">01 // DETERMINISTIC RECONCILIATION</div>
              <h3 className="pillar-title">ZERO-HALLUCINATION ARITHMETIC</h3>
              <p className="pillar-body">
                Mathematical operations are isolated strictly into deterministic TypeScript services. Debits and credits are balanced before state mutations occur, eliminating financial drift and model confabulation.
              </p>
            </div>
            <div className="pillar-footer-meta font-mono">
              INVARIANT: SUM(DEBITS) === SUM(CREDITS)
            </div>
          </div>

          <div className="pillar-card">
            <div>
              <div className="pillar-index font-mono">02 // CAUSAL EVIDENCE GRAPH</div>
              <h3 className="pillar-title">FULL FORENSIC ATTRIBUTION</h3>
              <p className="pillar-body">
                Every agent conclusion links directly to immutable database records. An audit log captures tool execution inputs, raw SQL outputs, and confidence intervals to withstand external auditor scrutiny.
              </p>
            </div>
            <div className="pillar-footer-meta font-mono">
              SPEC: RECORD_EVIDENCE() IMMUTABLE TRACE
            </div>
          </div>

          <div className="pillar-card">
            <div>
              <div className="pillar-index font-mono">03 // DUAL-KEY GOVERNANCE</div>
              <h3 className="pillar-title">HUMAN CONTROLLER SIGN-OFF</h3>
              <p className="pillar-body">
                The agent proposes; the finance team commands. Remediation actions such as vendor credit claims, AP payment freezes, or journal adjustments require cryptographic human approval.
              </p>
            </div>
            <div className="pillar-footer-meta font-mono">
              POLICY: DUAL-KEY SOX COMPLIANT APPROVALS
            </div>
          </div>
        </div>
      </section>

      {/* Technical Spec Sheet Table */}
      <section className="spec-sheet-section" id="specifications">
        <div className="section-eyebrow">SPECIFICATIONS // SYSTEM ARCHITECTURE</div>
        <h2 className="lab-heading">
          PLATFORM <span>specifications</span>
        </h2>

        <div className="spec-table-box font-mono" style={{ marginTop: "28px" }}>
          <div className="spec-row">
            <div className="spec-col-label">PRIMARY LEDGER ENGINE</div>
            <div className="spec-col-desc">PostgreSQL 16 relational double-entry ledger with strict transactional consistency and balance integrity checks.</div>
            <div className="spec-col-metric">ACID COMPLIANT</div>
          </div>
          <div className="spec-row">
            <div className="spec-col-label">TOOL EXECUTION SURFACE</div>
            <div className="spec-col-desc">8 isolated deterministic tools (getPnl, comparePeriods, breakDownMetric, getVendorSpend, compareVendorPrices).</div>
            <div className="spec-col-metric">ZOD SCHEMA VALIDATED</div>
          </div>
          <div className="spec-row">
            <div className="spec-col-label">MULTI-TENANT ISOLATION</div>
            <div className="spec-col-desc">All database transactions and evidence records enforce strict tenant separation via orgId foreign keys.</div>
            <div className="spec-col-metric">ROW-LEVEL PARTITIONED</div>
          </div>
          <div className="spec-row">
            <div className="spec-col-label">LLM INTEGRATION BOUNDARY</div>
            <div className="spec-col-desc">Model is restricted exclusively to hypothesis generation and tool selection. Never computes authoritative figures.</div>
            <div className="spec-col-metric">READ-ONLY REASONING</div>
          </div>
        </div>
      </section>

      {/* Terminal CTA Banner */}
      <section className="landing-cta-banner">
        <div className="cta-inner-card">
          <div style={{ fontSize: "10px", letterSpacing: "0.25em", color: "#10b981", marginBottom: "16px" }} className="font-mono">
            READY TO AUDIT YOUR GENERAL LEDGER?
          </div>
          <h2 className="cta-title">
            RESTORE CERTAINTY TO <span>your financial statements.</span>
          </h2>
          <p className="cta-desc font-mono">
            Launch the CFO Sentinel console to inspect live margin anomalies across the Acme Industries 12-month general ledger dataset.
          </p>
          <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
            <Link href="/dashboard" className="btn-primary-hero font-mono" style={{ background: "#fff", color: "#000", border: "1px solid #fff" }}>
              ACCESS CONSOLE NOW &rarr;
            </Link>
            <Link href="/incidents" className="btn-secondary-hero font-mono" style={{ background: "transparent", color: "#fff", borderColor: "#374151" }}>
              VIEW AUGUST INCIDENT
            </Link>
          </div>
        </div>
      </section>

      {/* Technical Footer */}
      <footer className="sentinel-footer font-mono">
        <div className="footer-inner">
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div className="brand-emblem" style={{ width: "22px", height: "22px", fontSize: "11px" }}>∑</div>
            <span style={{ fontWeight: "800", color: "#000" }}>CFO SENTINEL</span>
            <span style={{ color: "#94a3b8" }}>·</span>
            <span>Deterministic Financial Forensics Platform</span>
          </div>

          <div className="footer-links">
            <Link href="/dashboard">CONSOLE</Link>
            <Link href="/incidents">INCIDENTS</Link>
            <Link href="/approvals">APPROVALS</Link>
            <a href="https://github.com/shashwat558/CFO-Senitel" target="_blank" rel="noreferrer">SOURCE REPO</a>
          </div>

          <div style={{ color: "#94a3b8" }}>
            POSTGRESQL 16 · NEXT.JS 14 · REACT 18
          </div>
        </div>
      </footer>
    </div>
  );
}
