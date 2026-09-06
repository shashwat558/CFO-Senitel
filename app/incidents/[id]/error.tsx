"use client";

import Link from "next/link";

export default function IncidentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-container">
      <div className="section-eyebrow font-mono">SYSTEM TELEMETRY // INCIDENT DOSSIER ERROR</div>
      <h1 className="page-title">INCIDENT LOAD ERROR</h1>
      <div className="error-banner font-mono">
        <strong>ERROR:</strong> {error.message || "Failed to load this incident."}
      </div>
      <p className="page-sub font-mono">
        The requested incident may not exist, has been deleted, or is outside your authorized tenant scope.
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={() => reset()} className="btn-console-enter font-mono">
          RETRY LOAD
        </button>
        <Link href="/incidents" className="btn-secondary-hero font-mono">
          RETURN TO INCIDENTS QUEUE
        </Link>
      </div>
    </div>
  );
}
