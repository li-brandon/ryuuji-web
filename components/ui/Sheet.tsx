"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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

/** The longest transition on `el` in ms; 0 under prefers-reduced-motion (tokens.css zeroes them). */
function transitionMs(el: Element) {
  const { transitionDuration, transitionDelay } = getComputedStyle(el);
  const ms = (list: string) => list.split(",").map((s) => parseFloat(s) * (s.trim().endsWith("ms") ? 1 : 1000) || 0);
  const delays = ms(transitionDelay);
  return Math.max(0, ...ms(transitionDuration).map((d, i) => d + (delays[i % delays.length] ?? 0)));
}

/** Modal <dialog>: a bottom sheet on phones, a centered dialog on desktop. */
export function Sheet({ open, onClose, label, title, className, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelClosing = useRef<(() => void) | null>(null);
  // What the sheet last showed while open, kept on screen while it animates out.
  const [shown, setShown] = useState<{ label: string; children: ReactNode } | null>(open ? { label, children } : null);
  if (open && (shown?.label !== label || shown.children !== children)) setShown({ label, children });
  const view = open ? { label, children } : shown;

  /** Plays the close transition, then closes the dialog (which calls `onClose`). */
  const dismiss = useCallback(() => {
    const el = dialog.current;
    if (!el?.open || cancelClosing.current) return;
    const duration = transitionMs(el);
    // Reduced motion zeroes every duration: close right away.
    if (!duration) return el.close();
    const finish = () => {
      cancel();
      el.close();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && !e.pseudoElement) finish();
    };
    el.dataset.closing = "";
    el.addEventListener("transitionend", onEnd);
    const timer = setTimeout(finish, duration + 50);
    const cancel = () => {
      clearTimeout(timer);
      el.removeEventListener("transitionend", onEnd);
      delete el.dataset.closing;
      cancelClosing.current = null;
    };
    cancelClosing.current = cancel;
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!open) {
      dismiss();
      return;
    }
    // Reopening mid-close reverses the transition.
    cancelClosing.current?.();
    if (!el?.open) el?.showModal();
  }, [open, dismiss]);

  return (
    <dialog
      ref={dialog}
      className={cx(styles.sheet, className)}
      aria-label={view?.label ?? label}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClose={() => {
        cancelClosing.current?.();
        setShown(null);
        onClose();
      }}
      onClick={(e) => {
        // Taps on the backdrop target the dialog itself but land outside its box.
        const box = e.currentTarget.getBoundingClientRect();
        const outside = e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
        if (e.target === e.currentTarget && outside) dismiss();
      }}
    >
      <span className={styles.sheetHandle} aria-hidden="true" />
      {title && (
        <div className={styles.sheetHeader}>
          <h2 className={styles.sheetTitle}>{view?.label ?? label}</h2>
          <Button variant="ghost" icon="close" aria-label="Close" onClick={dismiss} />
        </div>
      )}
      {view && (title ? <div className={styles.sheetBody}>{view.children}</div> : view.children)}
    </dialog>
  );
}
