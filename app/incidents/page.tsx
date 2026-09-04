"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Incident {
  id: string;
  title: string;
  type: string;
  status: string;
  severity: string;
  detectedAt: string;
  _count?: { findings: number; evidence: number; actions: number };
}

export default function IncidentsPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/incidents")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setItems(j.items);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Incidents</h1>
      <p className="sub">Financial incidents open for investigation. Agent timeline ships in Phase 2.</p>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel list">
        {items.length === 0 && !error ? <p className="muted">No incidents yet.</p> : null}
        {items.map((i) => (
          <Link key={i.id} href={`/incidents/${i.id}`} className="row card" style={{ marginBottom: 10 }}>
            <span className={`badge ${i.status}`}>{i.status}</span>{" "}
            <span className={`badge ${i.severity}`}>{i.severity}</span>
            <div style={{ fontWeight: 700, marginTop: 8 }}>{i.title}</div>
            <div className="muted">
              {i.type} · detected {new Date(i.detectedAt).toLocaleDateString()} ·{" "}
              {i._count?.evidence ?? 0} evidence · {i._count?.findings ?? 0} findings
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
