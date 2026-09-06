"use client";

import Link from "next/link";

export default function IncidentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="error-container">
      <div className="section-eyebrow font-mono">SYSTEM TELEMETRY // INCIDENT QUEUE ERROR</div>
      <h1 className="page-title">TELEMETRY ERROR</h1>
      <div className="error-banner font-mono">
        <strong>ERROR:</strong> {error.message || "Failed to load incidents."}
      </div>
      <p className="page-sub font-mono">
        Verify PostgreSQL service and database migrations:
        <br />
        <code className="inline">docker compose up -d</code> then{" "}
        <code className="inline">npx prisma migrate dev &amp;&amp; npx prisma db seed</code>
      </p>
      <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
        <button onClick={() => reset()} className="btn-console-enter font-mono">
          RETRY REQUEST
        </button>
        <Link href="/dashboard" className="btn-secondary-hero font-mono">
          RETURN TO DASHBOARD
        </Link>
      </div>
    </div>
  );
}
