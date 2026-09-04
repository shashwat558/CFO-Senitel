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

  const link = (href: string, label: string) => (
    <Link key={href} href={href} className={`link${pathname.startsWith(href) ? " active" : ""}`}>
      {label}
    </Link>
  );

  return (
    <nav className="nav">
      <Link href="/dashboard" style={{ textDecoration: "none" }} className="brand">
        CFO Sentinel<span>.</span>
      </Link>
      {link("/dashboard", "Dashboard")}
      {link("/incidents", "Incidents")}
      {link("/approvals", "Approvals")}
      <span className="health" title="Backend + database connectivity">
        <span className={`dot ${db === "up" ? "up" : db === "down" ? "down" : ""}`} />
        db: {db}
      </span>
    </nav>
  );
}
