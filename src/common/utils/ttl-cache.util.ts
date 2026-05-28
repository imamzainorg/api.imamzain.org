/**
 * Tiny single-value-per-key TTL cache. In-process only, so a multi-instance
 * deployment has one copy per replica — fine for the read-mostly data we
 * cache here (settings, languages, contest questions) because each replica
 * still updates the underlying DB row on writes; the worst-case stale window
 * is the configured TTL.
 *
 * Not a full LRU: we trim entries by expiry when the map grows, which is
 * enough for the small number of keys this codebase uses (~dozens at most).
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (this.entries.size > 1000) this.trim();
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  private trim(): void {
    const now = Date.now();
    for (const [k, v] of this.entries) {
      if (v.expiresAt < now) this.entries.delete(k);
    }
  }
}
