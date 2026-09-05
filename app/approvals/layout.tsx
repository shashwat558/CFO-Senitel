import { SiteNav } from "@/components/SiteNav";

export default function ApprovalsLayout({
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
