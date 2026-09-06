"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { EvidenceInspector } from "@/components/EvidenceInspector";
import { StreamStatusChip, useRunStream } from "@/components/LiveTimeline";
import { useToast } from "@/components/Toasts";

interface ActionItem {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  payload: Record<string, unknown> | null;
  simulationResult: unknown;
  verificationResult: unknown;
}

interface Detail {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  severity: string;
  findings: Array<{ id: string; title: string; confidence: number }>;
  evidence: Array<{ id: string; findingId: string | null; toolName: string; input: unknown; output: unknown; summary: string; occurredAt: string; sourceType?: string | null; sourceId?: string | null }>;
  actions: ActionItem[];
}

interface Run {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  input: { question?: string };
  _count?: { steps: number };
}

interface Step {
  id: string;
  seq: number;
  toolName: string | null;
  input: unknown;
  output: unknown;
  reasoning: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
}

const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString() : "";

function JsonBlock({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return <span className="muted font-mono">—</span>;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="json-block">{text}</pre>;
}

function hypothesesFromContent(content: unknown): Array<{
  statement: string; status: string; confidence: number;
}> {
  if (Array.isArray(content)) return content as never;
  if (typeof content === "object" && content !== null) {
    const hyp = (content as { hypotheses?: unknown }).hypotheses;
    if (Array.isArray(hyp)) return hyp as never;
  }
  return [];
}

export default function IncidentDetailPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeSteps, setActiveSteps] = useState<Step[]>([]);
  const [question, setQuestion] = useState("");
  const [starting, setStarting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const { push } = useToast();
  const wasLiveRef = useRef(false);
  const [statusTarget, setStatusTarget] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const r = await fetch(`/api/incidents/${params.id}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setData(j);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    }
  }, [params.id]);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`/api/incidents/${params.id}/runs`);
      const j = await r.json();
      if (r.ok) setRuns(j.items ?? []);
    } catch {
      // non-fatal
    }
  }, [params.id]);

  const loadSteps = useCallback(async (runId: string) => {
    const r = await fetch(`/api/incidents/${params.id}/runs/${runId}/steps`);
    const j = await r.json();
    return (j.items ?? []) as Step[];
  }, [params.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const activeRunId = runs.find((r) => r.status === "RUNNING")?.id ?? null;

  // Live event stream drives refreshes: every new SSE event id bumps
  // `revision`, and we re-fetch authoritative REST snapshots from it.
  // The hook falls back to 2s polling when EventSource is unavailable.
  const { revision: streamRevision, mode: streamMode } = useRunStream(
    params.id,
    activeRunId
  );

  useEffect(() => {
    if (!activeRunId) {
      setActiveSteps([]);
      // Polling fallback discovered completion between ticks: refresh once.
      if (wasLiveRef.current) {
        wasLiveRef.current = false;
        loadRuns();
        loadDetail();
      }
      return;
    }
    let cancelled = false;
    (async () => {
      await loadRuns();
      const steps = await loadSteps(activeRunId);
      if (!cancelled) setActiveSteps(steps);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRunId, streamRevision, loadRuns, loadSteps, loadDetail]);

  useEffect(() => {
    if (streamMode === "live" || streamMode === "polling") {
      wasLiveRef.current = true;
      return;
    }
    // Stream just closed after a live run: final refresh so fresh findings,
    // evidence, and the COMPLETED run appear without a manual reload.
    if (streamMode === "closed" && wasLiveRef.current) {
      wasLiveRef.current = false;
      loadRuns();
      loadDetail();
    }
  }, [streamMode, loadRuns, loadDetail]);

  const startInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3) {
      const msg = "Question must be at least 3 characters.";
      setActionError(msg);
      push(msg, "error");
      return;
    }
    setStarting(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/incidents/${params.id}/investigate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, maxIterations: 8 }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok && res.status !== 409) {
        throw new Error(j.error ?? `investigation failed (${res.status})`);
      }
      setQuestion("");
      await loadRuns();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Investigation could not start.";
      setActionError(msg);
      push(msg, "error");
    } finally {
      setStarting(false);
    }
  };

  const applyStatus = async () => {
    if (!statusTarget) return;
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/incidents/${params.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: statusTarget }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "transition failed");
      push(`Status → ${statusTarget}`, "success");
      setStatusTarget("");
      await loadDetail();
    } catch (err) {
      push(err instanceof Error ? err.message : "Transition failed.", "error");
    } finally {
      setStatusBusy(false);
    }
  };

  const cancelRun = async (runId: string) => {    setActionError(null);
    try {
      const res = await fetch(`/api/incidents/${params.id}/runs/${runId}/cancel`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "cancel failed");
      await loadRuns();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not cancel run.";
      setActionError(msg);
      push(msg, "error");
    }
  };

  if (error) {
    return (
      <div className="error-container">
        <div className="section-eyebrow font-mono">INCIDENT DOSSIER // ERROR</div>
        <h1 className="page-title">INCIDENT NOT FOUND</h1>
        <div className="error-banner font-mono">
          <strong>ERROR:</strong> {error}
        </div>
        <p className="page-sub font-mono">
          Could not load this incident dossier. It may have been deleted or is outside your organization scope.
        </p>
        <Link href="/incidents" className="btn-secondary-hero font-mono">
          &larr; BACK TO INCIDENTS QUEUE
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="loading-container">
        <div className="section-eyebrow font-mono">INCIDENT DOSSIER // INITIALIZING</div>
        <div className="skeleton skeleton-title" />
        <div className="skeleton skeleton-line" style={{ width: "30%" }} />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const canStart = !starting && !activeRunId;

  const toggleRun = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = { ...prev };
      if (next[runId]) delete next[runId];
      else next[runId] = true;
      return next;
    });
  };

  return (
    <>
      {/* Header Stage */}
      <div className="page-header-stage">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="section-eyebrow font-mono" style={{ margin: 0 }}>
            INCIDENT DOSSIER // {data.id.slice(0, 16).toUpperCase()}
          </div>
          <Link href="/incidents" className="muted font-mono" style={{ fontSize: "11px", letterSpacing: "0.1em" }}>
            &larr; INCIDENT QUEUE
          </Link>
        </div>

        <h1 className="page-title">{data.title}</h1>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <span className={`badge-tag ${data.status.toLowerCase()}`}>{data.status}</span>
          <span className={`badge-tag ${data.severity.toLowerCase()}`}>{data.severity}</span>
          <span className="badge-tag" style={{ background: "#f8fafc", borderColor: "var(--lp-border)" }}>
            CATEGORY // {data.type}
          </span>
          <span className="telemetry-chip font-mono" style={{ marginLeft: "auto" }}>
            FINDINGS: {data.findings.length} · EVIDENCE: {data.evidence.length} · ACTIONS: {data.actions.length}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span className="muted font-mono" style={{ fontSize: "11px", letterSpacing: "0.1em" }}>
            TRANSITION STATUS:
          </span>
          <select
            className="font-mono"
            value={statusTarget}
            onChange={(e) => setStatusTarget(e.target.value)}
            disabled={statusBusy}
            aria-label="Next incident status"
            style={{ fontSize: 11, padding: "6px 10px", border: "1px solid var(--lp-border)", borderRadius: 6, background: "#fff" }}
          >
            <option value="">SELECT NEXT STATE…</option>
            {["OPEN", "INVESTIGATING", "PENDING_APPROVAL", "RESOLVED", "CLOSED"]
              .filter((s) => s !== data.status)
              .map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
          </select>
          <button
            className="btn-console-enter"
            style={{ padding: "6px 14px", fontSize: 10 }}
            disabled={!statusTarget || statusBusy}
            onClick={applyStatus}
          >
            {statusBusy ? "…" : "APPLY"}
          </button>
        </div>
      </div>

      {/* Summary Dossier Panel */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// INCIDENT SUMMARY &amp; IMPACT</span>
          <span className="telemetry-chip font-mono">STATUS: {data.status}</span>
        </div>
        <p className="font-mono" style={{ fontSize: "13px", lineHeight: "1.7", color: "var(--lp-fg-muted)", margin: 0 }}>
          {data.description || "No description recorded for this incident."}
        </p>
      </div>

      {/* Autonomous Forensics Console & Investigator Composer */}
      <div className="forensics-console">
        <div className="console-header-bar font-mono">
          <div className="console-header-left">
            <div className="window-pills">
              <span className="window-pill red" />
              <span className="window-pill amber" />
              <span className="window-pill green" />
            </div>
            <span>AUTONOMOUS FORENSICS CONSOLE // INVESTIGATOR AGENT</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`beacon-dot ${activeRunId ? "" : "down"}`} style={!activeRunId ? { background: "#059669", boxShadow: "none", animation: "none" } : undefined} />
            <span>{activeRunId ? "RUNNING INVESTIGATION..." : "READY"}</span>
          </div>
        </div>

        <div className="console-body">
          <form onSubmit={startInvestigation} className="invest-form">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask the Investigator Agent — e.g. Why did gross margin fall in August?"
              disabled={!canStart}
              aria-label="Investigation question"
            />
            <button type="submit" disabled={!canStart}>
              {starting ? "DISPATCHING…" : activeRunId ? "INVESTIGATING…" : "RUN INVESTIGATION →"}
            </button>
            {activeRunId ? (
              <button type="button" className="btn-cancel" onClick={() => cancelRun(activeRunId)}>
                CANCEL RUN
              </button>
            ) : null}
          </form>

          {actionError ? (
            <div className="error-banner font-mono" style={{ marginTop: 14 }}>
              <strong>CONSOLE ALERT:</strong> {actionError}
            </div>
          ) : null}

          {activeRunId ? (
            <p className="font-mono" style={{ marginTop: 14, fontSize: "12px", color: "var(--lp-amber)" }}>
              // Autonomous agent active — traversing procure-to-pay lineage and recording Postgres evidence steps...
            </p>
          ) : null}
        </div>
      </div>

      {/* Live Investigation Timeline */}
      {activeRunId && activeSteps.length > 0 ? (
        <div className="dossier-panel" style={{ borderLeft: "3px solid var(--lp-blue)" }}>
          <div className="dossier-header">
            <div className="dossier-title">
              <span className="beacon-dot" style={{ display: "inline-block", marginRight: 8 }} />
              LIVE INVESTIGATION TIMELINE
            </div>
            <StreamStatusChip mode={activeRunId ? streamMode : "closed"} />
          </div>
          <Timeline steps={activeSteps} />
        </div>
      ) : null}

      {/* Investigation Runs Accordion */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// INVESTIGATION RUNS ARCHIVE ({runs.length})</span>
          <span className="telemetry-chip font-mono">AUDIT TRAIL</span>
        </div>

        {runs.length === 0 ? (
          <p className="font-mono muted" style={{ fontSize: "12px" }}>
            No investigations executed yet. Pose a forensic question above to launch the autonomous agent.
          </p>
        ) : (
          runs.map((run) => {
            const expanded = !!expandedRuns[run.id];
            return (
              <div key={run.id} className="run">
                <button className="run-head font-mono" onClick={() => toggleRun(run.id)}>
                  <div className="run-head-left">
                    <span className={`badge-tag ${run.status.toLowerCase()}`}>{run.status}</span>
                    <span className="run-head-title">
                      {run.input?.question || "Autonomous Investigation"}
                    </span>
                  </div>
                  <div className="run-head-right">
                    <span className="muted" style={{ fontSize: "11px" }}>
                      {run.startedAt ? `STARTED ${fmtTime(run.startedAt)}` : ""}
                      {run.finishedAt ? ` · FINISHED ${fmtTime(run.finishedAt)}` : ""}
                      {" · "}
                      {run._count?.steps ?? 0} STEPS
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--lp-fg-subtle)" }}>
                      {expanded ? "▲ COLLAPSE" : "▼ EXPAND"}
                    </span>
                  </div>
                </button>
                {run.status === "RUNNING" ? (
                  <div style={{ padding: "0 18px 12px" }}>
                    <button className="btn-cancel small" onClick={() => cancelRun(run.id)}>
                      CANCEL EXECUTION
                    </button>
                  </div>
                ) : null}
                {expanded ? <RunDetail runId={run.id} incidentId={params.id} /> : null}
              </div>
            );
          })
        )}
      </div>

      {/* Findings Panel */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// AGENT FINDINGS &amp; HYPOTHESES ({data.findings.length})</span>
          <span className="telemetry-chip font-mono">CONFIDENCE INDEX</span>
        </div>

        {data.findings.length === 0 ? (
          <p className="font-mono muted" style={{ fontSize: "12px" }}>
            No confirmed findings recorded. Run an investigation to test hypotheses against Postgres records.
          </p>
        ) : (
          data.findings.map((f) => (
            <div key={f.id} id={`finding-${f.id}`} className="finding-card font-mono">
              <div className="finding-info">
                <div className="finding-name">{f.title}</div>
                <div className="muted" style={{ fontSize: "11px" }}>
                  IDENTIFIER: {f.id} · AUTHORITATIVE TOOL VERIFIED
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="badge-tag" style={{ background: "var(--lp-green-bg)", color: "var(--lp-green)", borderColor: "var(--lp-green-border)", fontSize: "11px" }}>
                  CONFIDENCE {(f.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Evidence Panel */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// DETERMINISTIC EVIDENCE TRACES ({data.evidence.length})</span>
          <span className="telemetry-chip font-mono">POSTGRES JOURNAL VERIFIED</span>
        </div>

        <EvidenceInspector evidence={data.evidence} incidentId={params.id} />
      </div>

      {/* Actions Panel — propose → approve → execute → verify */}
      <div className="dossier-panel">
        <div className="dossier-header">
          <span className="dossier-title">// MITIGATION ACTIONS ({data.actions.length})</span>
          <span className="telemetry-chip font-mono">PROPOSE → APPROVE → EXECUTE → VERIFY</span>
        </div>

        <ProposeActionForm
          incidentId={params.id}
          findings={data.findings}
          onDone={loadDetail}
        />

        {data.actions.length === 0 ? (
          <p className="font-mono muted" style={{ fontSize: "12px", marginTop: 12 }}>
            No mitigation actions queued yet. Propose one from a finding above.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {data.actions.map((a) => (
              <ActionCard key={a.id} incidentId={params.id} action={a} onChanged={loadDetail} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function RunDetail({ runId, incidentId }: { runId: string; incidentId: string }) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/incidents/${incidentId}/runs/${runId}/steps`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "failed");
        setSteps(j.items ?? []);
      })
      .catch((e) => setErr(e.message));
  }, [runId, incidentId]);

  if (err) return <div className="error-banner font-mono" style={{ margin: 12 }}>{err}</div>;
  if (!steps) return <div className="muted font-mono" style={{ padding: 16 }}>FETCHING STEP TELEMETRY…</div>;
  if (steps.length === 0) return <div className="muted font-mono" style={{ padding: 16 }}>No steps recorded for this run.</div>;
  return (
    <div style={{ padding: "8px 18px 18px", borderTop: "1px solid var(--lp-border)" }}>
      <Timeline steps={steps} />
    </div>
  );
}

function Timeline({ steps }: { steps: Step[] }) {  return (
    <ol className="timeline">
      {steps.map((s) => (
        <TimelineStep key={s.id} step={s} />
      ))}
    </ol>
  );
}

function TimelineStep({ step }: { step: Step }) {
  const isPlan = (step.input as { phase?: string } | null)?.phase === "PLAN";
  const isHypothesis = !step.toolName && (step.input as { hypothesisId?: unknown } | null)?.hypothesisId != null;
  const isTool = !!step.toolName;
  const isDeliberation = !isPlan && !isHypothesis && !isTool;

  const content = typeof step.output === "object" && step.output !== null
    ? (step.output as { content?: unknown })
    : null;
  const hypotheses = isDeliberation ? hypothesesFromContent(content?.content) : [];
  const thinking =
    isDeliberation && typeof content?.content === "object" && content.content !== null
      ? (content.content as { thinking?: string }).thinking
      : null;

  if (isPlan) {
    const plan = (step.output ?? {}) as {
      objective?: string; period?: string; metric?: string;
      knownFacts?: string[]; unknowns?: string[]; initialPlan?: string[];
    };
    return (
      <li className="timeline-step plan font-mono">
        <span className="node-dot" />
        <div className="step-head">
          <span className="step-badge" style={{ background: "var(--lp-blue-bg)", color: "var(--lp-blue)", borderColor: "var(--lp-blue-border)" }}>
            INVESTIGATION PLAN
          </span>
          <span className="muted" style={{ fontSize: "11px" }}>{fmtTime(step.startedAt)}</span>
        </div>
        <div className="step-body">
          <p><strong>OBJECTIVE:</strong> {plan.objective ?? "—"}</p>
          <p className="muted">PERIOD: {plan.period ?? "—"} · TARGET METRIC: {plan.metric ?? "—"}</p>
          {plan.knownFacts?.length ? (
            <p className="muted">VERIFIED FACTS: {plan.knownFacts.join("; ")}</p>
          ) : null}
          {plan.unknowns?.length ? (
            <p className="muted">UNRESOLVED: {plan.unknowns.join("; ")}</p>
          ) : null}
          {plan.initialPlan?.length ? (
            <ul className="plan-list">
              {plan.initialPlan.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          ) : null}
        </div>
      </li>
    );
  }

  if (isTool) {
    const isError = step.status === "ERROR";
    return (
      <li className={`timeline-step tool ${isError ? "err" : ""} font-mono`}>
        <span className="node-dot" />
        <div className="step-head">
          <span className={`step-badge ${isError ? "err" : "ok"}`}>
            TOOL CALL {isError ? "✕ FAILED" : "✓ EXECUTED"}
          </span>
          <code className="inline">{step.toolName}</code>
          <span className="muted" style={{ fontSize: "11px", marginLeft: "auto" }}>{fmtTime(step.startedAt)}</span>
        </div>
        <div className="step-grid">
          <div>
            <div className="muted" style={{ fontSize: "10px", marginBottom: 4, letterSpacing: "0.1em" }}>SCHEMA INPUT</div>
            <JsonBlock value={step.input} />
          </div>
          <div>
            <div className="muted" style={{ fontSize: "10px", marginBottom: 4, letterSpacing: "0.1em" }}>POSTGRES ARITHMETIC OUTPUT</div>
            <JsonBlock value={step.output} />
          </div>
        </div>
      </li>
    );
  }

  if (isHypothesis) {
    const h = (step.output ?? {}) as {
      statement?: string; status?: string; confidence?: number;
      supportingEvidence?: string[]; contradictoryEvidence?: string[];
    };
    return (
      <li className="timeline-step hypothesis font-mono">
        <span className="node-dot" />
        <div className="step-head">
          <span className={`step-badge hyp ${h.status}`}>HYPOTHESIS {h.status}</span>
          <span className="muted" style={{ fontSize: "11px" }}>
            CONFIDENCE {(h.confidence ?? 0).toFixed(2)} · {fmtTime(step.startedAt)}
          </span>
        </div>
        <p style={{ fontWeight: 600, color: "#000", marginTop: 4 }}>{h.statement ?? "—"}</p>
        {h.supportingEvidence?.length ? (
          <p className="muted" style={{ fontSize: "12px" }}>SUPPORTING: {h.supportingEvidence.join("; ")}</p>
        ) : null}
        {h.contradictoryEvidence?.length ? (
          <p className="muted" style={{ fontSize: "12px" }}>CONTRADICTING: {h.contradictoryEvidence.join("; ")}</p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="timeline-step deliberation font-mono">
      <span className="node-dot" />
      <div className="step-head">
        <span className="step-badge">AGENT DELIBERATION</span>
        <span className="muted" style={{ fontSize: "11px" }}>{fmtTime(step.startedAt)}</span>
      </div>
      {thinking ? <p className="thinking">{thinking}</p> : <JsonBlock value={step.output} />}
      {hypotheses.length > 0 ? (
        <div className="hyp-list">
          {hypotheses.map((h, i) => (
            <div key={i} className="hyp-row">
              <span className={`step-badge hyp ${h.status}`}>{h.status}</span>
              <span className="muted">{(h.confidence ?? 0).toFixed(2)}</span>
              <span style={{ color: "#000" }}>{h.statement}</span>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

const ACTION_TYPES = ["RECOMMENDATION", "VENDOR_DISPUTE", "PAYMENT_HOLD", "FORECAST_UPDATE", "JOURNAL_DRAFT"];
const VERIFY_TOOLS = ["", "getPnl", "compareVendorPrices"];

function ProposeActionForm({
  incidentId,
  findings,
  onDone,
}: {
  incidentId: string;
  findings: Array<{ id: string; title: string }>;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [findingId, setFindingId] = useState(findings[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState("RECOMMENDATION");
  const [description, setDescription] = useState("");
  const [verifyTool, setVerifyTool] = useState("");
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyExpected, setVerifyExpected] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!findingId && findings[0]) setFindingId(findings[0].id);
  }, [findings, findingId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!findingId) {
      push("Select a finding first — run an investigation if none exist.", "error");
      return;
    }
    if (title.trim().length < 3) {
      push("Title must be at least 3 characters.", "error");
      return;
    }
    let payload: Record<string, unknown> = {};
    if (verifyTool) {
      try {
        payload = {
          verification: {
            toolName: verifyTool,
            input: verifyInput.trim() ? JSON.parse(verifyInput) : {},
            expected: verifyExpected.trim() ? JSON.parse(verifyExpected) : {},
          },
        };
      } catch {
        push("Verification input/expected must be valid JSON.", "error");
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ findingId, title: title.trim(), type, description, payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "propose failed");
      push("Action proposed — decide it in the Approvals queue.", "success");
      setTitle("");
      setDescription("");
      setVerifyInput("");
      setVerifyExpected("");
      onDone();
    } catch (err) {
      push(err instanceof Error ? err.message : "Propose failed.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (findings.length === 0) return null;

  return (
    <form onSubmit={submit} className="font-mono" style={{ border: "1px solid var(--lp-border)", borderRadius: 8, padding: 16, marginBottom: 4, background: "#fff" }}>
      <div className="muted" style={{ fontSize: 10, letterSpacing: "0.1em", marginBottom: 10 }}>
        PROPOSE MITIGATION ACTION // OPENS A PENDING APPROVAL
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={{ fontSize: 11 }}>
          <span className="muted">FINDING</span>
          <select value={findingId} onChange={(e) => setFindingId(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}>
            {findings.map((f) => (
              <option key={f.id} value={f.id}>{f.title.slice(0, 60)}</option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 11 }}>
          <span className="muted">ACTION TYPE</span>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}>
            {ACTION_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>
      <label style={{ fontSize: 11, display: "block", marginTop: 10 }}>
        <span className="muted">TITLE</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Place Apex Steel payments on hold"
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}
        />
      </label>
      <label style={{ fontSize: 11, display: "block", marginTop: 10 }}>
        <span className="muted">RATIONALE</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Why is this recommended? Cite the evidence."
          style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}
        />
      </label>
      <label style={{ fontSize: 11, display: "block", marginTop: 10 }}>
        <span className="muted">VERIFY WITH TOOL (OPTIONAL — POWERS POST-EXECUTION VERIFICATION)</span>
        <select value={verifyTool} onChange={(e) => setVerifyTool(e.target.value)} style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 12 }}>
          {VERIFY_TOOLS.map((t) => (
            <option key={t} value={t}>{t === "" ? "NONE — VERIFY WILL REPORT HONESTLY" : t}</option>
          ))}
        </select>
      </label>
      {verifyTool ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <label style={{ fontSize: 11 }}>
            <span className="muted">TOOL INPUT (JSON, MUST INCLUDE orgId)</span>
            <textarea value={verifyInput} onChange={(e) => setVerifyInput(e.target.value)} rows={3} placeholder='{"orgId": "...", "year": 2024, "month": 8}' style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 11, fontFamily: "monospace" }} />
          </label>
          <label style={{ fontSize: 11 }}>
            <span className="muted">CLAIMED FIGURES (JSON SUBSET)</span>
            <textarea value={verifyExpected} onChange={(e) => setVerifyExpected(e.target.value)} rows={3} placeholder='{"revenue": 1200000}' style={{ display: "block", width: "100%", marginTop: 4, padding: "6px 8px", fontSize: 11, fontFamily: "monospace" }} />
          </label>
        </div>
      ) : null}
      <button type="submit" className="btn-console-enter" style={{ marginTop: 12, padding: "8px 18px", fontSize: 11 }} disabled={busy}>
        {busy ? "PROPOSING…" : "PROPOSE ACTION →"}
      </button>
    </form>
  );
}

function ActionCard({
  incidentId,
  action,
  onChanged,
}: {
  incidentId: string;
  action: ActionItem;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState<"execute" | "verify" | null>(null);

  const run = async (verb: "execute" | "verify") => {
    setBusy(verb);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/actions/${action.id}/${verb}`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `${verb} failed`);
      push(`Action ${verb}d — ${j.action?.status ?? j.result?.verified ? "verified" : "recorded"}`, "success");
      onChanged();
    } catch (err) {
      push(err instanceof Error ? err.message : `${verb} failed.`, "error");
    } finally {
      setBusy(null);
    }
  };

  const payload = action.payload ?? {};
  const findingId = typeof payload.findingId === "string" ? payload.findingId : null;
  const verification = (payload.verification ?? null) as { toolName?: string } | null;
  const sim = action.simulationResult as { summary?: string } | null;
  const ver = action.verificationResult as { verified?: boolean; detail?: string; checkedAt?: string } | null;

  return (
    <div className="action-card font-mono">
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>{action.title}</strong>
          <span className={`badge-tag ${action.status.toLowerCase()}`}>{action.status}</span>
          <span className="muted" style={{ fontSize: 10 }}>{action.type}</span>
        </div>
        {action.description ? (
          <p className="muted" style={{ fontSize: 11, margin: "6px 0 0", lineHeight: 1.6 }}>{action.description}</p>
        ) : null}
        <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>
          ACTION ID: {action.id}
          {findingId ? <> · FINDING: <a href={`#finding-${findingId}`}>{findingId.slice(0, 12)}…</a></> : null}
          {verification?.toolName ? <> · VERIFY VIA: <code className="inline">{verification.toolName}</code></> : null}
        </div>
        {sim?.summary ? (
          <p style={{ fontSize: 11, margin: "6px 0 0", color: "var(--lp-fg-muted)" }}>SIMULATION: {sim.summary}</p>
        ) : null}
        {ver ? (
          <p style={{ fontSize: 11, margin: "6px 0 0", color: ver.verified ? "var(--lp-green)" : "var(--lp-amber)" }}>
            VERIFICATION {ver.verified ? "✓ PASSED" : "✕ FAILED"}: {ver.detail} {ver.checkedAt ? `· ${new Date(ver.checkedAt).toLocaleString()}` : ""}
          </p>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {action.status === "PROPOSED" ? (
          <Link href="/approvals" className="muted" style={{ fontSize: 10 }}>DECIDE IN QUEUE &rarr;</Link>
        ) : null}
        {action.status === "APPROVED" ? (
          <button className="btn-console-enter" style={{ padding: "6px 14px", fontSize: 10 }} disabled={busy !== null} onClick={() => run("execute")}>
            {busy === "execute" ? "…" : "EXECUTE"}
          </button>
        ) : null}
        {action.status === "EXECUTED" ? (
          <button className="btn-console-enter" style={{ padding: "6px 14px", fontSize: 10 }} disabled={busy !== null} onClick={() => run("verify")}>
            {busy === "verify" ? "…" : "VERIFY"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
