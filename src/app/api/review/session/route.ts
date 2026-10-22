import { z } from "zod";
import { requireReviewer } from "@/lib/auth";
import { guard, readJson } from "@/lib/route";

export const dynamic = "force-dynamic";

const MAX_AGE_SECONDS = 60 * 60 * 8;

/**
 * SameSite=Strict is the CSRF defence for cookie-authenticated review calls:
 * the browser won't attach this cookie to requests started from another site.
 */
function sessionCookie(value: string, maxAge: number): string {
  return [
    `reviewer_token=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");
}

/** Is the current cookie (or bearer token) a valid reviewer credential? */
export function GET(req: Request) {
  return guard(async () => {
    requireReviewer(req);
    return Response.json({ authenticated: true });
  });
}

/** Human sign-in: validates the reviewer token and stores it in an httpOnly cookie. */
export function POST(req: Request) {
  return guard(async () => {
    const { token } = z
      .object({ token: z.string().min(1) })
      .strict()
      .parse(await readJson(req));
    // Reuse the same check every review route uses.
    requireReviewer(
      new Request(req.url, { headers: { authorization: `Bearer ${token}` } }),
    );
    return Response.json(
      { authenticated: true },
      { headers: { "set-cookie": sessionCookie(token, MAX_AGE_SECONDS) } },
    );
  });
}

export function DELETE() {
  return Response.json(
    { authenticated: false },
    { headers: { "set-cookie": sessionCookie("", 0) } },
  );
}
