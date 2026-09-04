"use client";

import { useEffect, useState } from "react";

interface Incident {
  id: string;
  title: string;
  status: string;
}

export default function ApprovalsPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/incidents?status=PENDING_APPROVAL")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setItems(j.items);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Approvals</h1>
      <p className="sub">
        Consequential actions require human approval (Phase 3). This foundation page proves the
        frontend ↔ API ↔ database path for the approval queue.
      </p>
      {error ? <p className="error">{error}</p> : null}
      <div className="panel">
        <h2>Pending approval ({items.length})</h2>
        {items.length === 0 ? (
          <p className="muted">Queue is empty. Approval workflow, simulation, and verification land in Phase 3.</p>
        ) : (
          items.map((i) => <div key={i.id}>• {i.title}</div>)
        )}
      </div>
    </>
  );
}
