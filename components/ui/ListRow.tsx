import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import styles from "./ui.module.css";

type Props = Omit<HTMLAttributes<HTMLLIElement>, "title"> & {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
};

/** A list item: leading art, a one-line title and subtitle that truncate, trailing accessory. */
export function ListRow({ title, subtitle, leading, trailing, className, ...rest }: Props) {
  return (
    <li className={cx(styles.row, className)} {...rest}>
      {leading}
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{title}</span>
        {subtitle && <span className={styles.rowSubtitle}>{subtitle}</span>}
      </span>
      {trailing}
    </li>
  );
}
