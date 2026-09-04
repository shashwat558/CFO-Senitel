"use client";

import { useEffect, useState } from "react";

interface Detail {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  severity: string;
  findings: Array<{ id: string; title: string; confidence: number }>;
  evidence: Array<{ id: string; toolName: string; summary: string; occurredAt: string }>;
  actions: Array<{ id: string; title: string; status: string }>;
}

export default function IncidentDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/incidents/${params.id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [params.id]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading incident…</p>;

  return (
    <>
      <h1>{data.title}</h1>
      <p className="sub">
        <span className={`badge ${data.status}`}>{data.status}</span> · {data.type} ·{" "}
        {data.severity}
      </p>
      <div className="panel">
        <h2>Summary</h2>
        <p className="muted">{data.description || "No description."}</p>
      </div>
      <div className="panel">
        <h2>Findings ({data.findings.length})</h2>
        {data.findings.length === 0 ? (
          <p className="muted">No findings yet — the Phase 2 Investigator Agent will post hypotheses here.</p>
        ) : (
          data.findings.map((f) => <div key={f.id}>• {f.title}</div>)
        )}
      </div>
      <div className="panel">
        <h2>Evidence ({data.evidence.length})</h2>
        {data.evidence.length === 0 ? (
          <p className="muted">No evidence yet — every tool call will be recorded here with input/output.</p>
        ) : (
          data.evidence.map((e) => (
            <div key={e.id} className="muted">
              <code className="inline">{e.toolName}</code> {e.summary}
            </div>
          ))
        )}
      </div>
      <div className="panel">
        <h2>Actions ({data.actions.length})</h2>
        {data.actions.length === 0 ? (
          <p className="muted">No actions proposed. Recommendations + approvals ship in Phase 3.</p>
        ) : (
          data.actions.map((a) => <div key={a.id}>• {a.title} ({a.status})</div>)
        )}
      </div>
    </>
  );
}
