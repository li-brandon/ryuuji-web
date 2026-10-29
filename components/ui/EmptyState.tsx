import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./ui.module.css";

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={styles.empty}>
      <span className={styles.emptyIcon}>
        <Icon name={icon} size={32} />
      </span>
      <h2 className={styles.emptyTitle}>{title}</h2>
      <p className={styles.emptyBody}>{children}</p>
      {action && <div className={styles.emptyAction}>{action}</div>}
    </section>
  );
}
