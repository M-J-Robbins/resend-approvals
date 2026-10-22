import type { ReactNode } from "react";
import "./tokens.css";

export const metadata = { title: "Email approvals" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
