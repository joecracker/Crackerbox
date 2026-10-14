// A phone's connection to the laptop drops whenever the phone goes to the
// camera, a file picker, another app or sleep. The laptop ties a phone page's
// session to its connection, so a reconnect used to look like a brand new phone
// and every send from the old page was turned down. This keeps a page's
// connection object for a while after its socket closes, so the same page
// coming back (it sends a stable page id) is handed the same one.
export const PHONE_SESSION_GRACE_MS = 5 * 60_000;

export function parsePageId(rawUrl: string | undefined): string | null {
  try {
    const id = new URL(rawUrl ?? "/", "http://internal").searchParams.get(
      "pid",
    );
    return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export class ResumableSessions<T> {
  private readonly entries = new Map<
    string,
    { value: T; timer: ReturnType<typeof setTimeout> | null }
  >();

  constructor(
    private readonly graceMs: number,
    private readonly onExpire: (value: T) => void,
  ) {}

  /** The page's existing session if it is still held, otherwise a new one. */
  acquire(id: string | null, create: () => T): { value: T; resumed: boolean } {
    if (id) {
      const existing = this.entries.get(id);
      if (existing) {
        if (existing.timer) clearTimeout(existing.timer);
        existing.timer = null;
        return { value: existing.value, resumed: true };
      }
    }
    const value = create();
    if (id) this.entries.set(id, { value, timer: null });
    return { value, resumed: false };
  }

  /**
   * Call when the page's current socket closes. A page with an id gets the
   * grace period to come back; one without ends right away.
   */
  release(id: string | null, value: T): void {
    const entry = id ? this.entries.get(id) : undefined;
    if (!id || !entry) {
      this.onExpire(value);
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.entries.delete(id);
      this.onExpire(entry.value);
    }, this.graceMs);
    entry.timer.unref?.();
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.entries.clear();
  }
}
