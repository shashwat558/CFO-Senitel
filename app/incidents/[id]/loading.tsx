export default function IncidentDetailLoading() {
  return (
    <div className="loading-container font-mono">
      <div className="section-eyebrow font-mono">INCIDENT DOSSIER // RETRIEVING</div>
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-line" style={{ width: "30%" }} />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
      <div className="skeleton skeleton-card" />
    </div>
  );
}
