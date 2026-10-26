"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/client/api";
import { AgentNote } from "./AgentNote";
import { useAnnounce } from "./Announcer";
import { Button } from "./Button";
import styles from "./SignIn.module.css";

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const announce = useAnnounce();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token.trim()) {
      setError("Enter the reviewer token.");
      input.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.signIn(token.trim());
      setToken("");
      announce("Signed in.");
      onSignedIn();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Sign-in failed.";
      setError(message);
      announce(message);
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Email approvals</h1>
        <p className={styles.lede}>
          Sign in with the reviewer token to review emails that agents have drafted. Nothing is
          sent until you approve it.
        </p>
        <form className={styles.form} onSubmit={submit} noValidate>
          <label className={styles.label} htmlFor="reviewer-token">
            Reviewer token
          </label>
          <input
            ref={input}
            id="reviewer-token"
            className={styles.input}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            disabled={busy}
          />
          {error && (
            <p id={errorId} className={styles.error}>
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <AgentNote />
      </div>
    </main>
  );
}
