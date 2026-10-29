"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import styles from "./ui.module.css";

type ToastOptions = { message: string; actionLabel?: string; onAction?: () => void; duration?: number };

/** One toast; the provider positions and animates it. */
export function Toast({ message, actionLabel, onAction }: Omit<ToastOptions, "duration">) {
  return (
    <div className={styles.toast}>
      <span className={styles.toastMessage}>{message}</span>
      {actionLabel && onAction && (
        <button type="button" className={styles.toastAction} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

const ToastContext = createContext<(toast: ToastOptions) => void>(() => {});

/** `const toast = useToast(); toast({ message, actionLabel: "Undo", onAction })`. A new toast replaces the last. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const show = useCallback((toast: ToastOptions) => setCurrent({ ...toast, id: Date.now() }), []);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => setCurrent(null), current.duration ?? 5000);
    return () => clearTimeout(timer);
  }, [current]);

  return (
    <ToastContext value={show}>
      {children}
      <div className={styles.toaster} role="status" aria-live="polite">
        {current && (
          <Toast
            key={current.id}
            message={current.message}
            actionLabel={current.actionLabel}
            onAction={
              current.onAction &&
              (() => {
                current.onAction?.();
                setCurrent(null);
              })
            }
          />
        )}
      </div>
    </ToastContext>
  );
}
