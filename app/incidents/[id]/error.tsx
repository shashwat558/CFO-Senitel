"use client";

export default function IncidentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <h1>Incident</h1>
      <p className="error">{error.message || "Failed to load this incident."}</p>
      <p className="muted">It may have been deleted or is outside your org.</p>
      <button onClick={() => reset()} className="btn-cancel">
        Retry
      </button>
    </>
  );
}
