"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";

interface SyncRun {
  id: string;
  provider: string;
  status: string;
  cursor: string | null;
  counts: Record<string, number> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function SyncPanel() {
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [busy, setBusy] = useState(false);
  const { push } = useToast();

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/connect/sync?limit=5");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setRuns(j.runs ?? []);
    } catch (e) {
      push(e instanceof Error ? e.message : "sync ledger failed", "error");
    }
  }, [push]);

  useEffect(() => {
    load();
  }, [load]);

  const trigger = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/connect/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "dodo" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "sync failed");
      push(
        `Sync tick: ${j.pulled} pulled · ${j.staged} staged · ${j.promoted} promoted · ${j.rejected} rejected`,
        "success"
      );
      await load();
    } catch (e) {
      push(e instanceof Error ? e.message : "Sync failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  const latest = runs[0] ?? null;

  return (
    <div className="dossier-panel" style={{ marginBottom: 24 }}>
      <div className="dossier-header">
        <span className="dossier-title">// EXTERNAL SYNC — DODO PAYMENTS (READ-ONLY)</span>
        <button
          className="btn-console-enter"
          style={{ padding: "6px 14px", fontSize: 10 }}
          disabled={busy}
          onClick={trigger}
        >
          {busy ? "SYNCING…" : "RUN SYNC TICK →"}
        </button>
      </div>
      {latest ? (
        <div className="font-mono" style={{ fontSize: 11 }}>
          <span className={`badge-tag ${latest.status.toLowerCase()}`}>{latest.status}</span>{" "}
          <span className="muted">
            {latest.provider.toUpperCase()} · {new Date(latest.startedAt).toLocaleString()}
            {latest.error ? ` · ERROR: ${latest.error}` : ""}
            {latest.counts ? ` · ${Object.entries(latest.counts).map(([k, v]) => `${k}:${v}`).join(" ")}` : ""}
          </span>
        </div>
      ) : (
        <p className="font-mono muted" style={{ fontSize: 12 }}>
          No sync ticks recorded yet. The scheduler pulls → stages → promotes on demand.
        </p>
      )}
    </div>
  );
}
