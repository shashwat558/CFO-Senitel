import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-wrapper">
      <div className="hairline-grid-y" aria-hidden="true" />
      <SiteNav />
      <main className="shell">{children}</main>
      <SiteFooter />
    </div>
  );
}
