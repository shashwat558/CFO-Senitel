"use client";

import Link from "next/link";
import { useState } from "react";

export default function LandingPage() {
  const [activeCategory, setActiveCategory] = useState("COGS AUDIT");

  const categories = [
    "COGS AUDIT",
    "VENDOR ARBITRAGE",
    "PO MATCHING",
    "LEDGER DRIFT",
    "ANOMALY DETECTION",
  ];

  return (
    <div className="landing-root">
      {/* Top Navigation */}
      <header className="landing-nav">
        <Link href="/" className="brand-title">
          <span className="brand-badge">S</span>
          CFO SENTINEL
        </Link>

        <nav className="nav-links">
          <a href="#ledger">LEDGER</a>
          <a href="#investigation">INVESTIGATION</a>
          <a href="#evidence">EVIDENCE GRAPH</a>
          <a href="#governance">GOVERNANCE</a>
        </nav>

        <div className="nav-actions">
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#6b7280" }}>
            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            <span className="font-mono">LEDGER ENGINE V2.0 LIVE</span>
          </div>
          <Link href="/dashboard" className="btn-nav-outline font-mono">
            ENTER DASHBOARD <span style={{ fontSize: "12px" }}>&rarr;</span>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <section className="hero-wrapper">
        {/* Wireframe geometric backdrop like Attachment 1 */}
        <div className="wireframe-poly-container" aria-hidden="true">
          <svg
            viewBox="0 0 600 600"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: "100%", height: "100%" }}
          >
            {/* Outer Decagon / Octagon */}
            <polygon
              points="300,30 490,90 570,280 500,470 320,570 130,520 40,350 80,150"
              stroke="#cbd5e1"
              strokeWidth="1.2"
            />
            {/* Inner rotated polygon */}
            <polygon
              points="300,75 510,210 440,490 170,510 90,260"
              stroke="#94a3b8"
              strokeWidth="1.4"
            />
            {/* Geometric star polygons */}
            <polygon
              points="140,110 460,110 540,360 300,550 60,360"
              stroke="#e2e8f0"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />
            <polygon
              points="300,50 550,450 50,450"
              stroke="#cbd5e1"
              strokeWidth="1.2"
              strokeDasharray="6 6"
            />
            <polygon
              points="300,550 50,150 550,150"
              stroke="#cbd5e1"
              strokeWidth="1.2"
              strokeDasharray="6 6"
            />
            {/* Fine coordinate diagonals */}
            <line x1="300" y1="30" x2="300" y2="570" stroke="#f1f5f9" strokeWidth="1.5" />
            <line x1="40" y1="350" x2="570" y2="280" stroke="#f1f5f9" strokeWidth="1.5" />
            <circle cx="300" cy="300" r="180" stroke="#e2e8f0" strokeWidth="1" strokeDasharray="2 3" />
            <circle cx="300" cy="300" r="4" fill="#000" />
            <circle cx="210" cy="210" r="3" fill="#64748b" />
            <circle cx="390" cy="210" r="3" fill="#64748b" />
            <circle cx="390" cy="390" r="3" fill="#64748b" />
            <circle cx="210" cy="390" r="3" fill="#64748b" />
          </svg>
        </div>

        <div className="hero-content">
          <div className="status-tag">
            <span className="status-dot" />
            <span>FINANCIAL REASONING ENGINE V2.0 LIVE</span>
          </div>

          <h1 className="hero-headline">
            INVESTIGATE
            <span className="hero-headline-italic">variances</span>
          </h1>

          <p className="hero-subtitle">
            // Autonomous financial incident investigation and root-cause verification with zero hallucination.
          </p>

          <div className="hero-actions">
            <Link href="/incidents" className="btn-dark">
              INITIALISE CONTEXT <span style={{ fontSize: "12px" }}>&#8599;</span>
            </Link>
            <Link href="/dashboard" className="btn-light">
              VIEW SPECS <span style={{ fontSize: "11px" }}>&#9638;</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 3 Pillars Feature Triad (bottom of Attachment 1) */}
      <section className="feature-tri-grid">
        <div className="feature-col">
          <div className="feature-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
          </div>
          <div className="feature-col-title">INSTANT RECONCILIATION</div>
          <div className="feature-col-desc">
            Watch general ledger drifts resolve instantly as postings hit. No waiting — pure deterministic mathematical proof.
          </div>
        </div>

        <div className="feature-col">
          <div className="feature-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          </div>
          <div className="feature-col-title">SEAMLESS AUDIT TRAIL</div>
          <div className="feature-col-desc">
            Our agentic pipeline intelligently links invoices, POs, and contract lines to guarantee every calculation traces back to truth.
          </div>
        </div>

        <div className="feature-col">
          <div className="feature-icon-box">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" />
              <line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" />
              <line x1="15" y1="20" x2="15" y2="23" />
              <line x1="20" y1="9" x2="23" y2="9" />
              <line x1="20" y1="14" x2="23" y2="14" />
              <line x1="1" y1="9" x2="4" y2="9" />
              <line x1="1" y1="14" x2="4" y2="14" />
            </svg>
          </div>
          <div className="feature-col-title">ANY ERP, ANY SYSTEM</div>
          <div className="feature-col-desc">
            Connect standard double-entry records from NetSuite, SAP, or PostgreSQL. Deterministic calculations over authoritative data.
          </div>
        </div>
      </section>

      {/* How It Works Section (Attachment 2 style) */}
      <section className="workflow-section" id="investigation">
        <div className="section-tag">HOW IT WORKS</div>

        <div className="workflow-header">
          <h2 className="section-title">
            BRINGING NUMBERS <span>to truth</span>
          </h2>

          <div className="tag-pills">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`tag-pill ${activeCategory === cat ? "active" : ""}`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <p className="section-desc-mono">
          A seamless journey from raw ERP general ledger transactions to fully verified root-cause analysis, tailored exactly to CFO standards.
        </p>

        {/* 3 Step Cards */}
        <div className="step-cards-row">
          {/* Step 01 */}
          <div className="step-card">
            <div>
              <div className="step-card-header">
                <span className="step-card-num">01</span>
                <div className="step-icon-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
              </div>
              <span className="step-badge">INGEST</span>
              <div className="step-card-title">STREAM GENERAL LEDGER</div>
              <p className="step-card-body">
                Connect double-entry journals, PO commitments, and vendor invoices. Every debited line reconciles against balanced credits in real-time.
              </p>
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px dashed #e5e7eb", paddingTop: "12px", fontSize: "10px", color: "#9ca3af" }} className="font-mono">
              STATUS: POSTINGS BALANCED [DEBITS == CREDITS]
            </div>
          </div>

          {/* Step 02 */}
          <div className="step-card">
            <div>
              <div className="step-card-header">
                <span className="step-card-num">02</span>
                <div className="step-icon-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
              </div>
              <span className="step-badge">ISOLATE</span>
              <div className="step-card-title">DISCOVER VARIANCE</div>
              <p className="step-card-body">
                Autonomous agents detect margin degradation, price variances, and unexpected spikes across multi-period P&amp;L baselines.
              </p>
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px dashed #e5e7eb", paddingTop: "12px", fontSize: "10px", color: "#9ca3af" }} className="font-mono">
              TARGET: AUG MARGIN FALL (-4.82pp DETECTED)
            </div>
          </div>

          {/* Step 03 */}
          <div className="step-card">
            <div>
              <div className="step-card-header">
                <span className="step-card-num">03</span>
                <div className="step-icon-btn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              </div>
              <span className="step-badge">RESOLVE</span>
              <div className="step-card-title">PROVE &amp; APPROVE</div>
              <p className="step-card-body">
                Traced evidence links the exact offending vendor invoice against negotiated contract unit prices with human-in-the-loop approvals.
              </p>
            </div>
            <div style={{ marginTop: "16px", borderTop: "1px dashed #e5e7eb", paddingTop: "12px", fontSize: "10px", color: "#9ca3af" }} className="font-mono">
              RESULT: APEX STEEL OVERCHARGE CONFIRMED
            </div>
          </div>
        </div>

        {/* Live Architecture Terminal Simulation */}
        <div className="terminal-block" id="ledger">
          <div className="terminal-bar">
            <div className="terminal-dots">
              <div className="terminal-dot-single" />
              <div className="terminal-dot-single" />
              <div className="terminal-dot-single" />
            </div>
            <span>DETERMINISTIC_EXECUTION_TRACE :: ACME_INDUSTRIES_2024</span>
            <span>VERIFIED_SQL_TX</span>
          </div>
          <div className="terminal-content">
            <div style={{ color: "#10b981", marginBottom: "8px" }}>
              // RULE 1: LLM NEVER COMPUTES AUTHORITATIVE FINANCIAL NUMBERS.
            </div>
            <div>[08:14:02] AGENT_LOOP: Triggering hypothesis evaluation for incident #INC-2024-08</div>
            <div>[08:14:03] TOOL_CALL: comparePeriods(periodA: "2024-07", periodB: "2024-08", metric: "GROSS_MARGIN")</div>
            <div>[08:14:03] RETURN: grossMarginVariance = -4.82pp (Revenue: $1,420,000 | COGS: $980,000)</div>
            <div>[08:14:04] TOOL_CALL: compareVendorPrices(vendorId: "vnd_apex_steel", period: "2024-08")</div>
            <div>[08:14:05] RETURN: Billed unit price: $148.50/ton vs Contract master: $116.00/ton (+28.01% deviation)</div>
            <div style={{ color: "#b45309", marginTop: "8px" }}>
              [08:14:06] EVIDENCE_STORED: id=ev_0892a7 &rarr; Billed delta = $48,750.00 &rarr; Confidence: 0.99
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span className="brand-badge">S</span>
          <span style={{ fontWeight: "700", color: "#000", letterSpacing: "0.1em" }}>CFO SENTINEL</span>
          <span style={{ marginLeft: "10px" }}>Deterministic Financial Investigation Infrastructure</span>
        </div>
        <div style={{ display: "flex", gap: "24px" }} className="font-mono">
          <Link href="/dashboard" style={{ textDecoration: "underline" }}>LAUNCH APP</Link>
          <Link href="/incidents" style={{ textDecoration: "underline" }}>ACTIVE INCIDENTS</Link>
          <a href="https://github.com" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>GITHUB</a>
        </div>
      </footer>
    </div>
  );
}
