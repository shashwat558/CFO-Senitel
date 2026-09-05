import { SiteNav } from "@/components/SiteNav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteNav />
      <main className="shell">{children}</main>
    </>
  );
}
