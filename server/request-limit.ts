import { createHash, randomBytes } from "node:crypto";

export interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

// Per-instance, bounded best-effort limiter. Hash keys so student identifiers are not stored.
export function createWindowRateLimiter(windowMs: number, maxEntries = 10000) {
  const entries = new Map<string, { count: number; expiresAt: number }>();
  const salt = randomBytes(16);

  return (rawKey: string, limit: number, now = Date.now()): RateDecision => {
    const key = createHash("sha256").update(salt).update(rawKey).digest("hex");
    let entry = entries.get(key);
    if (!entry || now >= entry.expiresAt) {
      if (!entry && entries.size >= maxEntries) {
        for (const [candidate, value] of entries) {
          if (now >= value.expiresAt) entries.delete(candidate);
        }
        // Prefer an evicted quota over globally blocking every new student.
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      }
      entry = { count: 0, expiresAt: now + windowMs };
      entries.set(key, entry);
    }
    if (entry.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
