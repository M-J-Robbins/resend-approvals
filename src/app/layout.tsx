import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./tokens.css";
import "./base.css";

export const metadata: Metadata = {
  title: "Email approvals",
  description: "Review and approve emails drafted by agents.",
  // Private tool: keep it out of search engines.
  robots: { index: false, follow: false },
  // No Referer on any request, including the email's own images in the
  // preview: srcdoc frames inherit this page's policy, so a tracking pixel
  // can't tell the email is being reviewed here.
  referrer: "no-referrer",
  // For agents that land on the review UI: where the agent docs are.
  alternates: {
    types: {
      "text/markdown": [{ url: "/SKILL.md", title: "Agent skill: how to use this service's API" }],
      "text/plain": [{ url: "/llms.txt", title: "llms.txt" }],
    },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
