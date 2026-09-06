"use client";

import { useEffect, useRef, useState } from "react";

export type StreamMode = "live" | "polling" | "closed" | "error";

export interface StreamEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
}

const TERMINAL = new Set(["agent_finished", "stream_error"]);

/**
 * Follow one investigation run over SSE, resuming from `cursor` on reconnect.
 * The stream is a push notification channel: every new event id bumps
 * `revision`, and callers re-fetch authoritative REST snapshots (steps/runs)
 * from it. Falls back to 2s polling when EventSource fails, matching the
 * legacy dossier behavior. Caps reconnects so a dead run cannot spin forever.
 */
export function useRunStream(
  incidentId: string | null,
  runId: string | null,
  opts: { pollMs?: number; maxReconnects?: number } = {}
): { revision: number; mode: StreamMode; lastEvent: StreamEvent | null } {
  const { pollMs = 2000, maxReconnects = 5 } = opts;
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<StreamMode>("closed");
  const [lastEvent, setLastEvent] = useState<StreamEvent | null>(null);
  const cursorRef = useRef(0);
  const reconnectsRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const closeAll = () => {
      esRef.current?.close();
      esRef.current = null;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    if (!incidentId || !runId) {
      closeAll();
      setMode("closed");
      return;
    }

    cursorRef.current = 0;
    reconnectsRef.current = 0;
    let disposed = false;

    const startPolling = () => {
      if (disposed || pollRef.current) return;
      setMode("polling");
      pollRef.current = setInterval(() => setRevision((r) => r + 1), pollMs);
    };

    const connect = () => {
      if (disposed) return;
      closeAll();
      const url =
        `/api/incidents/${incidentId}/runs/${runId}/stream` +
        `?follow=1&cursor=${cursorRef.current}&pollMs=1000`;
      let es: EventSource;
      try {
        es = new EventSource(url);
      } catch {
        startPolling();
        return;
      }
      esRef.current = es;
      setMode("live");

      const onEvent = (ev: MessageEvent) => {
        let parsed: StreamEvent;
        try {
          const data = JSON.parse(ev.data) as Record<string, unknown>;
          const id = Number((ev as MessageEvent & { lastEventId?: string }).lastEventId || 0);
          parsed = { id, type: ev.type, data };
        } catch {
          return;
        }
        if (parsed.id > cursorRef.current) cursorRef.current = parsed.id;
        setLastEvent(parsed);
        setRevision((r) => r + 1);
        if (TERMINAL.has(parsed.type)) {
          closeAll();
          setMode("closed");
        }
      };
      for (const type of [
        "agent_started",
        "agent_step",
        "tool_started",
        "tool_completed",
        "evidence_added",
        "agent_finished",
        "stream_error",
      ]) {
        es.addEventListener(type, onEvent as EventListener);
      }
      es.onerror = () => {
        closeAll();
        if (disposed) return;
        reconnectsRef.current += 1;
        if (reconnectsRef.current > maxReconnects) {
          setMode("error");
          startPolling();
          return;
        }
        // Reconnect resumes from the last seen id (cursor).
        setTimeout(() => {
          if (!disposed) connect();
        }, 1000);
      };
    };

    connect();
    return () => {
      disposed = true;
      closeAll();
    };
  }, [incidentId, runId, pollMs, maxReconnects]);

  return { revision, mode, lastEvent };
}

const MODE_LABEL: Record<StreamMode, string> = {
  live: "LIVE STREAM",
  polling: "POLLING 2.0s",
  closed: "STREAM CLOSED",
  error: "STREAM DEGRADED",
};

export function StreamStatusChip({ mode }: { mode: StreamMode }) {
  const live = mode === "live";
  return (
    <span className="telemetry-chip font-mono" title="Investigation event transport">
      <span
        className="beacon-dot"
        style={
          live
            ? undefined
            : { background: "#d97706", boxShadow: "0 0 8px rgba(217, 119, 6, 0.6)" }
        }
      />
      <span>{MODE_LABEL[mode]}</span>
    </span>
  );
}
