import type { CreatePublicOrderPayload } from './orders';

export const PENDING_ORDER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingOrderAttempt {
  idempotency_key: string;
  request_fingerprint: string;
  public_slug: string;
  created_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SLUG_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function pendingOrderStorageKey(publicSlug: string): string {
  return `pedon:pending-order:${publicSlug}`;
}

export function parsePendingOrderAttempt(
  raw: string | null,
  publicSlug: string,
  now = Date.now(),
): PendingOrderAttempt | null {
  if (raw === null || !SLUG_PATTERN.test(publicSlug)) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const attempt = value as Record<string, unknown>;
    const keys = Object.keys(attempt).sort();
    if (
      keys.join(',') !== 'created_at,idempotency_key,public_slug,request_fingerprint' ||
      typeof attempt.idempotency_key !== 'string' ||
      !UUID_PATTERN.test(attempt.idempotency_key) ||
      typeof attempt.request_fingerprint !== 'string' ||
      !DIGEST_PATTERN.test(attempt.request_fingerprint) ||
      attempt.public_slug !== publicSlug ||
      typeof attempt.created_at !== 'string'
    ) {
      return null;
    }
    const createdAt = Date.parse(attempt.created_at);
    if (
      !Number.isFinite(createdAt) ||
      createdAt > now ||
      now - createdAt > PENDING_ORDER_MAX_AGE_MS
    ) {
      return null;
    }
    return attempt as unknown as PendingOrderAttempt;
  } catch {
    return null;
  }
}

export function loadPendingOrderAttempt(publicSlug: string): PendingOrderAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = pendingOrderStorageKey(publicSlug);
    const attempt = parsePendingOrderAttempt(window.localStorage.getItem(key), publicSlug);
    if (attempt === null) window.localStorage.removeItem(key);
    return attempt;
  } catch {
    return null;
  }
}

export function savePendingOrderAttempt(attempt: PendingOrderAttempt): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(attempt);
  if (parsePendingOrderAttempt(serialized, attempt.public_slug) === null) return;
  try {
    window.localStorage.setItem(pendingOrderStorageKey(attempt.public_slug), serialized);
  } catch {
    // A blocked or full storage still permits the current in-memory attempt.
  }
}

export function clearPendingOrderAttempt(publicSlug: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(pendingOrderStorageKey(publicSlug));
  } catch {
    // Nothing else is persisted for recovery.
  }
}

export function createAttemptRecoveryHash(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export async function fingerprintOrderPayload(payload: CreatePublicOrderPayload): Promise<string> {
  const normalized = JSON.stringify(canonicalize(payload));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
