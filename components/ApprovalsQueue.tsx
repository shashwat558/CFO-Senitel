"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";

interface ApprovalItem {
  id: string;
  status: string;
  createdAt: string;
  action: { id: string; title: string; status: string; incidentId: string } | null;
  incident: { id: string; title: string } | null;
}

export function ApprovalsQueue() {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { push } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/approvals?status=PENDING");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setItems(j.items ?? []);
    } catch (e) {
      push(e instanceof Error ? e.message : "approvals failed", "error");
    } finally {
      setLoading(false);
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id: string, verdict: "approve" | "reject") => {
    setBusyId(id);
    try {
      const r = await fetch(`/api/approvals/${id}/${verdict}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `${verdict} failed`);
      push(`Approval ${verdict}d`, "success");
      await load();
    } catch (e) {
      push(e instanceof Error ? e.message : `${verdict} failed`, "error");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="muted font-mono" style={{ padding: "24px 0" }}>POLLING GOVERNANCE QUEUE…</div>;
  if (items.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "48px 24px" }}>
        <div className="section-eyebrow font-mono" style={{ justifyContent: "center" }}>ZERO PENDING INTERVENTIONS</div>
        <p className="muted font-mono" style={{ maxWidth: 520, margin: "10px auto 20px" }}>
          The approval queue is empty. When autonomous investigations propose contract amendments or invoice dispute actions, they will appear here for verification.
        </p>
        <Link href="/incidents" className="btn-secondary-hero font-mono">BROWSE ACTIVE INCIDENTS &rarr;</Link>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((a) => (
        <div key={a.id} className="finding-card font-mono">
          <div className="finding-info">
            <div className="finding-name">{a.action?.title ?? a.incident?.title ?? a.id}</div>
            <div className="muted" style={{ fontSize: "11px" }}>
              APPROVAL ID: {a.id} · ACTION: {a.action?.id ?? "—"} · {(a.incident?.title ?? "")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="badge-tag pending_approval">PENDING</span>
            <button className="btn-console-enter" style={{ padding: "6px 14px", fontSize: 10 }} disabled={busyId === a.id} onClick={() => decide(a.id, "approve")}>
              {busyId === a.id ? "…" : "APPROVE"}
            </button>
            <button className="btn-cancel small" disabled={busyId === a.id} onClick={() => decide(a.id, "reject")}>
              REJECT
            </button>
            {a.action?.incidentId ? (
              <Link href={`/incidents/${a.action.incidentId}`} className="muted" style={{ fontSize: 10 }}>VERIFY &rarr;</Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
