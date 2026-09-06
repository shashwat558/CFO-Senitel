"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export default function AuditLogPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(50);
  const [actionFilter, setActionFilter] = useState("");

  const load = useCallback(async (l: number, a: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(l) });
      if (a) params.set("action", a);
      const r = await fetch(`/api/audit-logs?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setItems(j.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(limit, actionFilter);
  }, [limit, actionFilter, load]);

  return (
    <>
      <div className="page-header-stage">
        <div className="section-eyebrow font-mono">
          GOVERNANCE &amp; COMPLIANCE // IMMUTABLE AUDIT TRAIL
        </div>
        <h1 className="page-title">
          AUDIT LOG
          <span className="serif-accent">org-scoped activity ledger</span>
        </h1>
        <p className="page-sub font-mono">
          // Every status transition, approval decision, and agent cancellation appends an AuditLog row · Actor + entity + metadata preserved
        </p>
      </div>

      {error ? (
        <div className="error-banner font-mono" style={{ marginBottom: 24 }}>
          <strong>AUDIT TRAIL ERROR:</strong> {error}
        </div>
      ) : null}

      <div className="filter-toolbar font-mono">
        <div className="filter-group">
          <span className="filter-label">ACTION FILTER:</span>
          <input
            className="lab-tab-btn"
            style={{ padding: "6px 10px", borderRadius: 6 }}
            placeholder="e.g. incident.status, approval.approve"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
          />
        </div>
        <div className="filter-meta">
          <div className="telemetry-chip font-mono">
            <span className="beacon-dot" />
            <span>{items.length} RECENT ENTRIES (LATEST {limit})</span>
          </div>
          {loading ? (
            <span className="muted font-mono" style={{ fontSize: "11px" }}>
              FETCHING…
            </span>
          ) : null}
        </div>
      </div>

      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// AUDITLOG READER V1</span>
          <div className="telemetry-chip font-mono">T3 GOVERNANCE API</div>
        </div>

        {items.length === 0 && !error && !loading ? (
          <div className="panel" style={{ textAlign: "center", padding: "48px 24px" }}>
            <div className="section-eyebrow font-mono" style={{ justifyContent: "center" }}>
              AUDIT TRAIL // EMPTY
            </div>
            <p className="muted font-mono">No audit entries match the active criteria.</p>
          </div>
        ) : null}

        <div className="approval-queue-list" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((entry) => (
            <div key={entry.id} className="approval-card" style={{ padding: "16px 20px" }}>
              <div className="font-mono" style={{ fontSize: "11px", color: "var(--lp-fg-subtle)" }}>
                {new Date(entry.createdAt).toLocaleString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
                {"  //  "}
                {entry.actor ? (
                  <span>
                    ACTOR: <strong>{entry.actor.name}</strong> ({entry.actor.email})
                  </span>
                ) : (
                  <span>ACTOR: SYSTEM</span>
                )}
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span className="badge-tag" style={{ background: "#f8fafc", borderColor: "var(--lp-border)" }}>
                  {entry.action}
                </span>
                {entry.entityType ? (
                  <span className="badge-tag">{entry.entityType}</span>
                ) : null}
                {entry.entityId ? (
                  <span className="muted font-mono" style={{ fontSize: "11px" }}>
                    ID: {entry.entityId}
                  </span>
                ) : null}
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 ? (
                <pre
                  className="font-mono"
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    color: "var(--lp-fg-muted)",
                    background: "var(--lp-bg-subtle)",
                    padding: 10,
                    borderRadius: 6,
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
