"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";
import { cx } from "./cx";
import styles from "./ui.module.css";

type Props = {
  open: boolean;
  /** Called however the sheet closes: Escape, backdrop tap, the close button or `open` turning false. */
  onClose: () => void;
  /** Accessible name; also shown as a heading with a close button when `title` is set. */
  label: string;
  title?: boolean;
  className?: string;
  children: ReactNode;
};

/** Modal <dialog>: a bottom sheet on phones, a centered dialog on desktop. */
export function Sheet({ open, onClose, label, title, className, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (open && !el?.open) el?.showModal();
    else if (!open && el?.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={cx(styles.sheet, className)}
      aria-label={label}
      onClose={onClose}
      onClick={(e) => {
        // Taps on the backdrop target the dialog itself but land outside its box.
        const box = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        if (e.target === e.currentTarget && outside) e.currentTarget.close();
      }}
    >
      <span className={styles.sheetHandle} aria-hidden="true" />
      {title && (
        <div className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>{label}</h2>
          <Button variant="ghost" icon="close" aria-label="Close" onClick={() => dialog.current?.close()} />
        </div>
      )}
      {open && (title ? <div className={styles.sheetBody}>{children}</div> : children)}
    </dialog>
  );
}
