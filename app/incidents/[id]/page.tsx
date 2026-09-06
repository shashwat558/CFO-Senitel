"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Detail {
  id: string;
  title: string;
  description: string;
  type: string;
  status: string;
  severity: string;
  findings: Array<{ id: string; title: string; confidence: number }>;
  evidence: Array<{ id: string; findingId: string | null; toolName: string; summary: string; occurredAt: string }>;
  actions: Array<{ id: string; title: string; status: string }>;
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

const RUN_STATUSES = ["RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString() : "";

const TERMINAL_RUN = (s: string) =>
  s === "COMPLETED" || s === "FAILED" || s === "CANCELLED";

/** Pretty-print a Json block for tool input/output. */
function JsonBlock({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return <span className="muted">—</span>;
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="json-block">{text}</pre>;
}

/** Normalize the hypothesis array nested inside a deliberation content payload. */
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      // non-fatal — the list may be empty while the DB warms up
    }
  }, [params.id]);

  const loadSteps = useCallback(async (runId: string) => {
    const r = await fetch(`/api/incidents/${params.id}/runs/${runId}/steps`);
    const j = await r.json();
    return (j.items ?? []) as Step[];
  }, [params.id]);

  // Initial load + every refresh of incident detail.
  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  // Poll the runs list while anything is RUNNING; pull steps for the active run.
  const activeRunId = runs.find((r) => r.status === "RUNNING")?.id ?? null;

  useEffect(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;

    if (!activeRunId) {
      setActiveSteps([]);
      return;
    }

    const tick = async () => {
      await loadRuns();
      const steps = await loadSteps(activeRunId);
      setActiveSteps(steps);
    };
    tick();
    pollingRef.current = setInterval(tick, 2000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeRunId, loadRuns, loadSteps]);

  // Refresh the incident detail whenever the poll set changes (evidence/findings
  // change as the loop runs).
  useEffect(() => {
    if (activeRunId) loadDetail();
  }, [activeRunId, loadDetail]);

  const startInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 3) {
      setActionError("Question must be at least 3 characters.");
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
      // 409 means one is already running — the poller will pick it up.
      setQuestion("");
      await loadRuns();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Investigation could not start.");
    } finally {
      setStarting(false);
    }
  };

  const cancelRun = async (runId: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/incidents/${params.id}/runs/${runId}/cancel`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "cancel failed");
      await loadRuns();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not cancel run.");
    }
  };

  if (error) {
    return (
      <>
        <h1>Incident</h1>
        <p className="error">{error}</p>
        <p className="muted">Could not load this incident. It may have been deleted or is outside your org.</p>
      </>
    );
  }
  if (!data) return <div className="skeleton skeleton-title" />;

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
      <h1>{data.title}</h1>
      <p className="sub">
        <span className={`badge ${data.status}`}>{data.status}</span> · {data.type} ·{" "}
        {data.severity}
      </p>

      <div className="panel">
        <h2>Summary</h2>
        <p className="muted">{data.description || "No description."}</p>
      </div>

      {/* Investigate composer */}
      <div className="panel">
        <h2>Investigate</h2>
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
            {starting ? "Starting…" : activeRunId ? "Running…" : "Investigate"}
          </button>
          {activeRunId ? <button type="button" className="btn-cancel" onClick={() => cancelRun(activeRunId)}>Cancel run</button> : null}
        </form>
        {actionError ? <p className="error" style={{ marginTop: 8 }}>{actionError}</p> : null}
        {activeRunId ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Investigation in progress — polled live below.
          </p>
        ) : null}
      </div>

      {/* Live timeline of the active run */}
      {activeRunId && activeSteps.length > 0 ? (
        <div className="panel">
          <h2>Live investigation timeline</h2>
          <Timeline steps={activeSteps} />
        </div>
      ) : null}

      {/* Runs list */}
      <div className="panel">
        <h2>Runs ({runs.length})</h2>
        {runs.length === 0 ? (
          <p className="muted">
            No investigations yet. Ask a question above and watch the agent work in real time.
          </p>
        ) : (
          runs.map((run) => {
            const expanded = !!expandedRuns[run.id];
            return (
              <div key={run.id} className="run">
                <button className="run-head" onClick={() => toggleRun(run.id)}>
                  <span className={`badge ${run.status}`}>{run.status}</span>
                  <span>
                    {run.input?.question?.slice(0, 90) || "Investigation"}
                  </span>
                  <span className="muted">
                    {run.startedAt ? `started ${fmtTime(run.startedAt)}` : ""}
                    {run.finishedAt ? ` · finished ${fmtTime(run.finishedAt)}` : ""}
                    {" · "}
                    {run._count?.steps ?? 0} steps
                  </span>
                  <span className="muted">{expanded ? "▲" : "▼"}</span>
                </button>
                {run.status === "RUNNING" ? (
                  <button className="btn-cancel small" onClick={() => cancelRun(run.id)}>
                    Cancel
                  </button>
                ) : null}
                {expanded ? <RunDetail runId={run.id} incidentId={params.id} /> : null}
              </div>
            );
          })
        )}
      </div>

      <div className="panel">
        <h2>Findings ({data.findings.length})</h2>
        {data.findings.length === 0 ? (
          <p className="muted">
            No findings yet — run an investigation and hypotheses will land here with status and confidence.
          </p>
        ) : (
          data.findings.map((f) => (
            <div key={f.id} id={`finding-${f.id}`}>
              • {f.title} (<span className="muted">{(f.confidence * 100).toFixed(0)}%</span>)
            </div>
          ))
        )}
      </div>

      <div className="panel">
        <h2>Evidence ({data.evidence.length})</h2>
        {data.evidence.length === 0 ? (
          <p className="muted">No evidence yet — every tool call will be recorded here with input/output.</p>
        ) : (
          data.evidence.map((e) => (
            <div key={e.id} className="evidence">
              <code className="inline">{e.toolName}</code> <span className="muted">{e.summary}</span>{" "}
              {e.findingId ? (
                <a
                  href={`#finding-${e.findingId}`}
                  className="muted"
                  title="Linked to a finding"
                >
                  (finding link)
                </a>
              ) : null}
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

/** Renders the detailed step timeline for a single run (fetched on demand). */
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

  if (err) return <p className="error" style={{ padding: 8 }}>{err}</p>;
  if (!steps) return <div className="muted" style={{ padding: 8 }}>Loading steps…</div>;
  if (steps.length === 0) return <p className="muted" style={{ padding: 8 }}>No steps yet.</p>;
  return <Timeline steps={steps} />;
}

/** Shared timeline renderer: PLAN → deliberation → tool calls + hypotheses. */
function Timeline({ steps }: { steps: Step[] }) {
  return (
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
      <li className="timeline-step plan">
        <div className="step-head">
          <span className="step-badge">PLAN</span>
          <span className="muted">{fmtTime(step.startedAt)}</span>
        </div>
        <div className="step-body">
          <p><strong>Objective:</strong> {plan.objective ?? "—"}</p>
          <p className="muted">Period: {plan.period ?? "—"} · Metric: {plan.metric ?? "—"}</p>
          {plan.knownFacts?.length ? (
            <p className="muted">Known: {plan.knownFacts.join("; ")}</p>
          ) : null}
          {plan.unknowns?.length ? (
            <p className="muted">Unknowns: {plan.unknowns.join("; ")}</p>
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
    return (
      <li className="timeline-step tool">
        <div className="step-head">
          <span className={`step-badge ${step.status === "ERROR" ? "err" : "ok"}`}>
            TOOL {step.status === "ERROR" ? "✕" : "✓"}
          </span>
          <code className="inline">{step.toolName}</code>
          <span className="muted">{fmtTime(step.startedAt)}</span>
        </div>
        <div className="step-grid">
          <div>
            <div className="muted">Input</div>
            <JsonBlock value={step.input} />
          </div>
          <div>
            <div className="muted">Output</div>
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
      <li className="timeline-step hypothesis">
        <div className="step-head">
          <span className={`step-badge hyp ${h.status}`}>HYPOTHESIS {h.status}</span>
          <span className="muted">
            confidence {(h.confidence ?? 0).toFixed(2)} · {fmtTime(step.startedAt)}
          </span>
        </div>
        <p>{h.statement ?? "—"}</p>
        {h.supportingEvidence?.length ? (
          <p className="muted">Supporting: {h.supportingEvidence.join("; ")}</p>
        ) : null}
        {h.contradictoryEvidence?.length ? (
          <p className="muted">Contradicting: {h.contradictoryEvidence.join("; ")}</p>
        ) : null}
      </li>
    );
  }

  // Deliberation (reasoning turn)
  return (
    <li className="timeline-step deliberation">
      <div className="step-head">
        <span className="step-badge">DELIBERATION</span>
        <span className="muted">{fmtTime(step.startedAt)}</span>
      </div>
      {thinking ? <p className="muted thinking">{thinking}</p> : <JsonBlock value={step.output} />}
      {hypotheses.length > 0 ? (
        <div className="hyp-list">
          {hypotheses.map((h, i) => (
            <div key={i} className="hyp-row">
              <span className={`step-badge hyp ${h.status}`}>{h.status}</span>
              <span className="muted">{(h.confidence ?? 0).toFixed(2)}</span>
              <span>{h.statement}</span>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}
