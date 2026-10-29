// Shared by every service instance and metadata refresh in this tab.
let queue: Promise<unknown> = Promise.resolve();

export function withWatchLogLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks?.request) {
      return navigator.locks.request("ryuuji-watch-log", operation);
    }

    // Without Web Locks, only this tab is serialized: concurrent tabs can still
    // write duplicate events or stale status. A notice lets other tabs reload;
    // BroadcastChannel is not a cross-tab mutex.
    const value = await operation();
    if (typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("ryuuji-library");
        try {
          channel.postMessage("watch-log-write");
        } finally {
          channel.close();
        }
      } catch {
        // Notification failure must not report an already committed write as failed.
      }
    }
    return value;
  });
  queue = result.catch(() => {});
  return result;
}
