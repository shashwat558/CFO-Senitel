"use client";

export default function IncidentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h1>Incidents</h1>
      <p className="error">{error.message || "Failed to load incidents."}</p>
      <p className="muted">
        Is PostgreSQL running and seeded?{" "}
        <code className="inline">docker compose up -d</code> then{" "}
        <code className="inline">npx prisma migrate dev && npx prisma db seed</code>
      </p>
      <button onClick={() => reset()} className="btn-cancel">
        Retry
      </button>
    </>
  );
}
