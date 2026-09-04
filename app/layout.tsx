import type { Metadata } from "next";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "CFO Sentinel",
  description: "Agentic financial incident investigation and response platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
