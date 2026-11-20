"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "@/lib/pwa";

/** Registers public/sw.js in production builds (see `registerServiceWorker`). */
export function ServiceWorker() {
  useEffect(() => {
    registerServiceWorker(process.env.NODE_ENV, navigator);
  }, []);
  return null;
}
