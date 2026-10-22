/**
 * These tests run against the REAL database in .env.local (the Neon dev
 * branch) and a FAKE Resend, so no email is ever sent.
 */

// Next's own env loader skips .env.local when NODE_ENV=test, so load it directly
// (needs Node 20.12+). Variables already set in the shell win.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: fall through to the checks below.
}

// Belt and braces: even if a test forgot to mock Resend, this key can't send.
process.env.RESEND_API_KEY = "re_test_dummy_never_sent";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Create .env.local first (see .env.example).");
}

// Refuse to run against the production branch. The tests only touch rows they
// create and delete them afterwards, but production should never see them.
const branch = (process.env.NEON_BRANCH ?? "").toLowerCase();
if (process.env.TEST_DB_OK !== "1" && (!branch || ["production", "main", "prod"].includes(branch))) {
  throw new Error(
    `Refusing to run tests: NEON_BRANCH is "${branch || "unset"}". ` +
      "Point .env.local at your dev branch (neon checkout dev), " +
      "or set TEST_DB_OK=1 if you are sure this database is disposable.",
  );
}
