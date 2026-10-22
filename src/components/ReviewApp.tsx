"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, setUnauthorizedHandler } from "@/lib/client/api";
import { AnnouncerProvider, useAnnounce } from "./Announcer";
import { Button } from "./Button";
import { Notice } from "./Notice";
import { SignIn } from "./SignIn";
import { Spinner } from "./Spinner";
import { Workspace } from "./Workspace";
import styles from "./ReviewApp.module.css";

type Session = "checking" | "signed-out" | "signed-in" | { error: string };

export function ReviewApp() {
  return (
    <AnnouncerProvider>
      <SessionGate />
    </AnnouncerProvider>
  );
}

function SessionGate() {
  const announce = useAnnounce();
  const router = useRouter();
  const [session, setSession] = useState<Session>("checking");

  const check = useCallback(() => {
    setSession("checking");
    api
      .checkSession()
      .then(() => setSession("signed-in"))
      .catch((e) =>
        setSession(
          e instanceof ApiError && e.status === 401
            ? "signed-out"
            : { error: e instanceof ApiError ? e.message : "Could not check your session." },
        ),
      );
  }, []);

  useEffect(check, [check]);

  // Any 401 from the API (expired or cleared cookie) returns to sign-in.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession("signed-out");
      announce("Your session has ended. Sign in again to continue.");
    });
    return () => setUnauthorizedHandler(null);
  }, [announce]);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setSession("signed-out");
      router.replace("/");
      announce("Signed out.");
    }
  }, [announce, router]);

  if (session === "checking") {
    return (
      <main className={styles.center} aria-busy="true">
        <p className={styles.loading}>
          <Spinner /> Checking your session…
        </p>
      </main>
    );
  }
  if (session === "signed-out") return <SignIn onSignedIn={() => setSession("signed-in")} />;
  if (session === "signed-in") return <Workspace onSignOut={signOut} />;

  return (
    <main className={styles.center}>
      <Notice tone="error" title="Couldn't reach the review service" headingLevel={2} actions={<Button onClick={check}>Try again</Button>}>
        <p>{session.error}</p>
      </Notice>
    </main>
  );
}
