export default function IncidentsLoading() {
  return (
    <div className="loading-container font-mono">
      <div className="section-eyebrow font-mono">INCIDENTS QUEUE // INITIALIZING</div>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" style={{ width: "35%" }} />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </div>
  );
}
