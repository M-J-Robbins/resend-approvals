import type { DraftView } from "@/lib/client/api";
import { plural } from "@/lib/client/format";
import styles from "./Recipients.module.css";

type Revision = DraftView["revision"];

export const recipientCount = (r: Pick<Revision, "to" | "cc" | "bcc">) =>
  r.to.length + r.cc.length + r.bcc.length;

/**
 * Every recipient, grouped. Approval applies to exactly these addresses, so
 * nothing is truncated or collapsed — Bcc included.
 */
export function Recipients({
  revision,
  headingLevel = 3,
  idPrefix,
}: {
  revision: Pick<Revision, "to" | "cc" | "bcc">;
  headingLevel?: 3 | 4;
  idPrefix: string;
}) {
  const Heading = `h${headingLevel}` as const;
  const Group = `h${headingLevel + 1}` as "h4" | "h5";
  const groups = [
    { key: "to", label: "To", list: revision.to },
    { key: "cc", label: "Cc", list: revision.cc },
    { key: "bcc", label: "Bcc", list: revision.bcc },
  ] as const;

  return (
    <section className={styles.recipients} aria-labelledby={`${idPrefix}-recipients`}>
      <Heading id={`${idPrefix}-recipients`} className={styles.heading}>
        Recipients <span className={styles.count}>({recipientCount(revision)})</span>
      </Heading>
      <div className={styles.groups}>
        {groups.map((g) => (
          <div key={g.key} className={styles.group}>
            <Group className={styles.groupLabel}>
              {g.label} <span className={styles.count}>({g.list.length})</span>
            </Group>
            {g.list.length > 0 ? (
              <ul className={styles.list} aria-label={`${g.label}: ${plural(g.list.length, "address", "addresses")}`}>
                {g.list.map((address, i) => (
                  <li key={`${address}-${i}`} className={styles.address}>
                    {address}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.none}>None</p>
            )}
            {g.key === "bcc" && g.list.length > 0 && (
              <p className={styles.note}>Hidden from the other recipients, but they will receive the email.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
