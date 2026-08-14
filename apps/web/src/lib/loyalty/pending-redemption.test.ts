import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingRedemption,
  loadPendingRedemption,
  pendingRedemptionKey,
  savePendingRedemption,
} from './pending-redemption';

const attempt = {
  public_slug: 'abc',
  idempotency_key: '22222222-2222-4222-8222-222222222222',
  recovery_secret: 'b'.repeat(64),
  reward_id: '11111111-1111-4111-8111-111111111111',
  created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
};

describe('pending redemption storage', () => {
  beforeEach(() => localStorage.clear());

  it('uses the strict slug-scoped key and persists exactly the allowed fields', () => {
    expect(savePendingRedemption(attempt)).toBe(true);
    expect(pendingRedemptionKey('abc')).toBe('pedon:pending-redemption:abc');
    expect(JSON.parse(localStorage.getItem(pendingRedemptionKey('abc'))!)).toEqual(attempt);
    expect(localStorage.getItem(pendingRedemptionKey('abc'))).not.toMatch(
      /cpf|phone|access_token|voucher|saldo/,
    );
  });

  it('retorna false quando o storage não garante a persistência verificável', () => {
    const blockedSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(savePendingRedemption(attempt)).toBe(false);
    blockedSet.mockRestore();

    const fullSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(savePendingRedemption(attempt)).toBe(false);
    fullSet.mockRestore();

    const blockedGet = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(savePendingRedemption(attempt)).toBe(false);
    blockedGet.mockRestore();

    const missingGet = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    expect(savePendingRedemption(attempt)).toBe(false);
    missingGet.mockRestore();

    const corruptedGet = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{"corrupt":true}');
    expect(savePendingRedemption(attempt)).toBe(false);
    corruptedGet.mockRestore();
  });

  it('loads an attempt up to 24 hours old', () => {
    savePendingRedemption(attempt);
    expect(
      loadPendingRedemption('abc', Date.parse(attempt.created_at) + 24 * 60 * 60 * 1000),
    ).toEqual(attempt);
  });

  it('removes expired, future, mismatched and extra-field attempts', () => {
    const key = pendingRedemptionKey('abc');
    for (const value of [
      attempt,
      { ...attempt, public_slug: 'other' },
      { ...attempt, access_token: 'a'.repeat(64) },
    ]) {
      localStorage.setItem(key, JSON.stringify(value));
      const now =
        value === attempt
          ? Date.parse(attempt.created_at) + 24 * 60 * 60 * 1000 + 1
          : Date.parse(attempt.created_at) + 1;
      expect(loadPendingRedemption('abc', now)).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
    }
    localStorage.setItem(key, JSON.stringify({ ...attempt, created_at: '2026-08-12T12:00:00Z' }));
    expect(loadPendingRedemption('abc', Date.parse(attempt.created_at))).toBeNull();
  });

  it('clears only the current slug attempt', () => {
    savePendingRedemption(attempt);
    savePendingRedemption({ ...attempt, public_slug: 'other' });
    clearPendingRedemption('abc');
    expect(localStorage.getItem(pendingRedemptionKey('abc'))).toBeNull();
    expect(localStorage.getItem(pendingRedemptionKey('other'))).not.toBeNull();
  });
});
