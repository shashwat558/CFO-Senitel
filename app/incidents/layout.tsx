import { SiteNav } from "@/components/SiteNav";

export default function IncidentsLayout({
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
