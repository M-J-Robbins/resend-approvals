import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tokens.css";
import "./base.css";

export const metadata: Metadata = {
  title: "Email approvals",
  description: "Review and approve emails drafted by agents.",
  // Private tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
