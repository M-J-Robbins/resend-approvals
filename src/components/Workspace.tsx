"use client";

import { Button } from "./Button";
import styles from "./Workspace.module.css";

export function Workspace({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>Email approvals</h1>
        <Button size="sm" variant="ghost" onClick={onSignOut}>
          Sign out
        </Button>
      </header>
      <main className={styles.main} />
    </div>
  );
}
