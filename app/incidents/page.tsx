"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";

interface Incident {
  id: string;
  title: string;
  type: string;
  status: string;
  severity: string;
  detectedAt: string;
  _count?: { findings: number; evidence: number; actions: number };
}

const STATUSES = [
  { key: "", label: "ALL STATUSES" },
  { key: "OPEN", label: "OPEN" },
  { key: "INVESTIGATING", label: "INVESTIGATING" },
  { key: "PENDING_APPROVAL", label: "PENDING APPROVAL" },
  { key: "RESOLVED", label: "RESOLVED" },
  { key: "CLOSED", label: "CLOSED" },
];
const PAGE_SIZE = 10;
const INCIDENT_TYPES = ["GROSS_MARGIN_DECLINE", "CASH_CRISIS", "REVENUE_LEAKAGE", "EXPENSE_SPIKE", "OTHER"];
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function IncidentsPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [ctitle, setCtitle] = useState("");
  const [ctype, setCtype] = useState("OTHER");
  const [cseverity, setCseverity] = useState("MEDIUM");
  const [cdescription, setCdescription] = useState("");
  const [creating, setCreating] = useState(false);
  const { push } = useToast();

  const load = useCallback(async (p: number, s: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (s) params.set("status", s);
      const r = await fetch(`/api/incidents?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setItems(j.items ?? []);
      setTotal(j.total ?? 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(page, status);
  }, [page, status, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilter = (s: string) => {
    setStatus(s);
    setPage(1);
  };

  const createIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ctitle.trim().length < 3) {
      push("Title must be at least 3 characters.", "error");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/incidents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: ctitle.trim(), type: ctype, severity: cseverity, description: cdescription }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "create failed");
      push("Incident opened.", "success");
      setCtitle("");
      setCdescription("");
      setShowCreate(false);
      setPage(1);
      await load(1, status);
    } catch (err) {
      push(err instanceof Error ? err.message : "Create failed.", "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="page-header-stage">
        <div className="section-eyebrow font-mono">
          AUTONOMOUS TRIAGE // INCIDENT QUEUE
        </div>
        <h1 className="page-title">
          FINANCIAL INCIDENTS
          <span className="serif-accent">forensic dossier queue</span>
        </h1>
        <p className="page-sub font-mono">
          // Continuous surveillance across GL lines, purchase orders, and supplier contracts · Hypotheses tested via deterministic arithmetic
        </p>
      </div>

      {error ? (
        <div className="error-banner font-mono" style={{ marginBottom: 24 }}>
          <strong>INCIDENT REPOSITORY ERROR:</strong> {error}
        </div>
      ) : null}

      {/* Filter Toolbar */}
      <div className="filter-toolbar font-mono">
        <div className="filter-group">
          <span className="filter-label">STATUS FILTER:</span>
          <div className="lab-tabs">
            {STATUSES.map((s) => (
              <button
                key={s.key}
                className={`lab-tab-btn ${status === s.key ? "active" : ""}`}
                onClick={() => applyFilter(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-meta">
          <div className="telemetry-chip font-mono">
            <span className="beacon-dot" />
            <span>{total} TOTAL INCIDENT{total === 1 ? "" : "S"}</span>
          </div>
          <button className="btn-console-enter" style={{ padding: "6px 14px", fontSize: 10 }} onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "CLOSE ×" : "＋ OPEN INCIDENT"}
          </button>
          {loading ? (
            <span className="muted font-mono" style={{ fontSize: "11px" }}>
              FETCHING…
            </span>
          ) : null}
        </div>
      </div>

      {showCreate ? (
        <form onSubmit={createIncident} className="dossier-panel font-mono" style={{ marginBottom: 24 }}>
          <div className="dossier-header">
            <span className="dossier-title">// OPEN NEW INCIDENT</span>
            <span className="telemetry-chip font-mono">MANUAL TRIAGE</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ fontSize: 11 }}>
              <span className="muted">TITLE</span>
              <input type="text" value={ctitle} onChange={(e) => setCtitle(e.target.value)} placeholder="e.g. Margin dip — September preview" style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }} />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ fontSize: 11 }}>
                <span className="muted">TYPE</span>
                <select value={ctype} onChange={(e) => setCtype(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}>
                  {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11 }}>
                <span className="muted">SEVERITY</span>
                <select value={cseverity} onChange={(e) => setCseverity(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
          </div>
          <label style={{ fontSize: 11, display: "block", marginTop: 10 }}>
            <span className="muted">DESCRIPTION</span>
            <textarea value={cdescription} onChange={(e) => setCdescription(e.target.value)} rows={2} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }} />
          </label>
          <button type="submit" className="btn-console-enter" style={{ marginTop: 12, padding: "8px 18px", fontSize: 11 }} disabled={creating}>
            {creating ? "OPENING…" : "OPEN INCIDENT →"}
          </button>
        </form>
      ) : null}

      {/* Incidents Cards List */}
      <div className="incident-list-container">
        {items.length === 0 && !error && !loading ? (
          <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div className="section-eyebrow font-mono" style={{ justifyContent: "center" }}>
              QUEUE STATUS // CLEAR
            </div>
            <p className="muted font-mono">No incidents match the active filter criteria.</p>
          </div>
        ) : null}

        {items.map((i) => (
          <Link key={i.id} href={`/incidents/${i.id}`} className="incident-card-row">
            <div className="incident-card-head font-mono">
              <div className="incident-badges">
                <span className={`badge-tag ${i.status.toLowerCase()}`}>{i.status}</span>
                <span className={`badge-tag ${i.severity.toLowerCase()}`}>{i.severity}</span>
                <span style={{ fontSize: "11px", color: "var(--lp-fg-subtle)" }}>
                  REF: {i.type}
                </span>
              </div>
              <div className="incident-date">
                DETECTED {new Date(i.detectedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }).toUpperCase()}
              </div>
            </div>

            <div className="incident-card-title">{i.title}</div>

            <div className="incident-card-meta font-mono">
              <span>TRACES: {i._count?.evidence ?? 0} EVIDENCE</span>
              <span>·</span>
              <span>HYPOTHESES: {i._count?.findings ?? 0} FINDINGS</span>
              <span>·</span>
              <span>PROPOSALS: {i._count?.actions ?? 0} ACTIONS</span>
              <span style={{ marginLeft: "auto", fontWeight: 700, color: "#000" }}>
                INSPECT DOSSIER &rarr;
              </span>
            </div>
          </Link>
        ))}
      </div>

      {/* Pager */}
      {totalPages > 1 && (
        <div className="pager font-mono">
          <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            &lsaquo; PREV
          </button>
          <span className="muted" style={{ fontSize: "11px" }}>
            PAGE {page} OF {totalPages}
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            NEXT &rsaquo;
          </button>
        </div>
      )}
    </>
  );
}
