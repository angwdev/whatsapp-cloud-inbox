/** Per-browser preferences kept in localStorage. */
const READ_RECEIPTS_KEY = 'whatsapp-cloud-inbox-read-receipts';

/** Mark messages as read (blue ticks) and show "typing…" to contacts. On by default. */
export function readReceiptsEnabled(): boolean {
  try {
    return window.localStorage.getItem(READ_RECEIPTS_KEY) !== 'false';
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();

export function setReadReceiptsEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(READ_RECEIPTS_KEY, String(enabled));
  } catch {
    // Falls back to the default next time.
  }
  listeners.forEach((listener) => listener());
}

/** For useSyncExternalStore: notified on changes in this tab and in other tabs. */
export function subscribeToPreferences(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}
