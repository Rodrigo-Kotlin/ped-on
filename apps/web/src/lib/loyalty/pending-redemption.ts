import { z } from 'zod';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

const pendingRedemptionSchema = z
  .object({
    public_slug: z.string().min(1),
    idempotency_key: z.string().uuid(),
    recovery_secret: z.string().regex(/^[a-f0-9]{64}$/),
    reward_id: z.string().uuid(),
    created_at: z.string(),
  })
  .strict();

export type PendingRedemption = z.infer<typeof pendingRedemptionSchema>;

export function pendingRedemptionKey(publicSlug: string): string {
  return `pedon:pending-redemption:${publicSlug}`;
}

export function savePendingRedemption(value: PendingRedemption): boolean {
  if (typeof window === 'undefined') return false;
  let parsed: PendingRedemption;
  try {
    parsed = pendingRedemptionSchema.parse(value);
  } catch {
    return false;
  }
  const key = pendingRedemptionKey(parsed.public_slug);
  try {
    window.localStorage.setItem(key, JSON.stringify(parsed));
  } catch {
    return false;
  }
  const recovered = loadPendingRedemption(parsed.public_slug);
  if (recovered === null) return false;
  return (
    recovered.public_slug === parsed.public_slug &&
    recovered.idempotency_key === parsed.idempotency_key &&
    recovered.recovery_secret === parsed.recovery_secret &&
    recovered.reward_id === parsed.reward_id &&
    recovered.created_at === parsed.created_at
  );
}

export function clearPendingRedemption(publicSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(pendingRedemptionKey(publicSlug));
  } catch {
    // No other redemption data is persisted.
  }
}

export function loadPendingRedemption(
  publicSlug: string,
  now = Date.now(),
): PendingRedemption | null {
  if (typeof window === 'undefined') return null;
  const key = pendingRedemptionKey(publicSlug);
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(key);
  } catch {
    return null;
  }
  if (stored === null) return null;

  try {
    const parsed = pendingRedemptionSchema.safeParse(JSON.parse(stored));
    const createdAt = parsed.success ? Date.parse(parsed.data.created_at) : Number.NaN;
    if (
      !parsed.success ||
      parsed.data.public_slug !== publicSlug ||
      !Number.isFinite(createdAt) ||
      createdAt > now ||
      now - createdAt > MAX_AGE_MS
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Invalid data cannot be used even if storage cleanup is blocked.
    }
    return null;
  }
}
