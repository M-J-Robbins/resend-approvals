import type { NextConfig } from "next";

const config: NextConfig = {
  // The review UI must not be framed by other sites (clickjacking). The
  // SameSite=Strict session cookie already keeps a framed copy signed out.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default config;
