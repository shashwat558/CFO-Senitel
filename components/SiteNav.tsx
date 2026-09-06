"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export function SiteNav() {
  const pathname = usePathname();
  const [db, setDb] = useState<"up" | "down" | "…">("…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setDb(j.db === "up" ? "up" : "down"))
      .catch(() => setDb("down"));
  }, []);

  const navLink = (href: string, label: string) => {
    const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`topbar-nav-link${isActive ? " active" : ""}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sentinel-topbar">
      <div className="sentinel-topbar-inner">
        <Link href="/" className="brand-emblem-wrap">
          <div className="brand-emblem">∑</div>
          <div className="brand-wordmark">CFO SENTINEL</div>
        </Link>

        <nav className="topbar-nav font-mono">
          {navLink("/dashboard", "DASHBOARD")}
          {navLink("/incidents", "INCIDENTS")}
          {navLink("/approvals", "APPROVALS")}
          {navLink("/audit", "AUDIT")}
          {navLink("/", "OVERVIEW")}
        </nav>

        <div className="topbar-telemetry">
          <div className="telemetry-chip font-mono" title="Backend + PostgreSQL connectivity">
            <span
              className="beacon-dot"
              style={
                db === "down"
                  ? { background: "#e11d48", boxShadow: "0 0 8px rgba(225, 29, 72, 0.6)" }
                  : db === "up"
                  ? undefined
                  : { background: "#d97706", boxShadow: "0 0 8px rgba(217, 119, 6, 0.6)" }
              }
            />
            <span>
              {db === "up"
                ? "POSTGRES GL // CONNECTED"
                : db === "down"
                ? "POSTGRES GL // OFFLINE"
                : "POSTGRES GL // CONNECTING"}
            </span>
          </div>
          <div className="telemetry-chip font-mono tenant-chip">
            <span>ORG // ACME</span>
          </div>
        </div>
      </div>
    </header>
  );
}
