import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="sentinel-footer">
      <div className="footer-inner font-mono">
        <div>&copy; 2024 CFO SENTINEL // DETERMINISTIC FINANCIAL FORENSICS ENGINE</div>
        <div className="footer-links">
          <Link href="/">OVERVIEW</Link>
          <Link href="/dashboard">DASHBOARD</Link>
          <Link href="/incidents">INCIDENTS</Link>
          <Link href="/approvals">APPROVALS</Link>
        </div>
      </div>
    </footer>
  );
}
