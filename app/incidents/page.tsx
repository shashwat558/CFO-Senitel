"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Incident {
  id: string;
  title: string;
  type: string;
  status: string;
  severity: string;
  detectedAt: string;
  _count?: { findings: number; evidence: number; actions: number };
}

const STATUSES = ["", "OPEN", "INVESTIGATING", "PENDING_APPROVAL", "RESOLVED", "CLOSED"];
const PAGE_SIZE = 10;

export default function IncidentsPage() {
  const [items, setItems] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

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

  // Re-fetch whenever page or filter changes.
  useEffect(() => {
    load(page, status);
  }, [page, status, load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applyFilter = (s: string) => {
    setStatus(s);
    setPage(1);
  };

  return (
    <>
      <h1>Incidents</h1>
      <p className="sub">
        Financial incidents open for investigation. Agent timeline live on each incident.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="filters">
        <label className="muted" htmlFor="status-filter">Status</label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => applyFilter(e.target.value)}
        >
          <option value="">All</option>
          {STATUSES.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="muted">{total} total</span>
        {loading ? <span className="muted">Loading…</span> : null}
      </div>

      <div className="panel list">
        {items.length === 0 && !error && !loading ? <p className="muted">No incidents match.</p> : null}
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

      <div className="pager">
        <button disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          ‹ Prev
        </button>
        <span className="muted">
          Page {page} of {totalPages}
        </span>
        <button
          disabled={page >= totalPages || loading}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
        >
          Next ›
        </button>
      </div>
    </>
  );
}
