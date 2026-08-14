import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingOrderAttempt,
  createAttemptRecoveryHash,
  fingerprintOrderPayload,
  loadPendingOrderAttempt,
  parsePendingOrderAttempt,
  pendingOrderStorageKey,
  savePendingOrderAttempt,
} from './pending-order';
import type { CreatePublicOrderPayload } from './orders';

function attemptAt(createdAt = new Date().toISOString()) {
  return {
    idempotency_key: '11111111-1111-4111-8111-111111111111',
    request_fingerprint: 'a'.repeat(64),
    public_slug: 'abc',
    created_at: createdAt,
  };
}

describe('pending order attempt', () => {
  beforeEach(() => window.localStorage.clear());

  it('persiste e carrega somente o contrato estrito sem PII', () => {
    const attempt = attemptAt();
    expect(savePendingOrderAttempt(attempt)).toBe(true);

    const raw = window.localStorage.getItem(pendingOrderStorageKey('abc'))!;
    expect(JSON.parse(raw)).toEqual(attempt);
    expect(raw).not.toMatch(/Maria|52998224725|99999|loyalty|token|payload|X-Salada/i);
    expect(loadPendingOrderAttempt('abc')).toEqual(attempt);

    clearPendingOrderAttempt('abc');
    expect(loadPendingOrderAttempt('abc')).toBeNull();
  });

  it('retorna false quando o storage não garante a persistência verificável', () => {
    const attempt = attemptAt();

    const blockedSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(savePendingOrderAttempt(attempt)).toBe(false);
    blockedSet.mockRestore();

    const fullSet = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(savePendingOrderAttempt(attempt)).toBe(false);
    fullSet.mockRestore();

    const blockedGet = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(savePendingOrderAttempt(attempt)).toBe(false);
    blockedGet.mockRestore();

    const missingGet = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    expect(savePendingOrderAttempt(attempt)).toBe(false);
    missingGet.mockRestore();

    const corruptedGet = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('{"corrupt":true}');
    expect(savePendingOrderAttempt(attempt)).toBe(false);
    corruptedGet.mockRestore();
  });

  it('rejeita campos extras, slug divergente e tentativas expiradas', () => {
    const now = Date.parse('2026-08-11T13:00:00.000Z');
    const attempt = attemptAt('2026-08-11T12:00:00.000Z');
    expect(
      parsePendingOrderAttempt(JSON.stringify({ ...attempt, phone: '11999999999' }), 'abc', now),
    ).toBeNull();
    expect(parsePendingOrderAttempt(JSON.stringify(attempt), 'outro', now)).toBeNull();
    expect(
      parsePendingOrderAttempt(
        JSON.stringify({ ...attempt, created_at: '2026-08-09T12:00:00.000Z' }),
        'abc',
        now,
      ),
    ).toBeNull();
  });

  it('gera SHA-256 estável para o payload normalizado e muda com o token', async () => {
    const payload: CreatePublicOrderPayload = {
      menu_version_id: 'v1',
      operation_revision: 'r1',
      service_mode: 'pickup',
      payment_method: 'pix',
      customer: { name: 'Maria', phone: '11999999999' },
      items: [{ menu_item_id: 'item-1', quantity: 1 }],
      loyalty_token: 'a'.repeat(64),
    };
    const reordered = {
      ...payload,
      customer: { phone: '11999999999', name: 'Maria' },
    };

    const first = await fingerprintOrderPayload(payload);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await fingerprintOrderPayload(reordered)).toBe(first);
    expect(await fingerprintOrderPayload({ ...payload, loyalty_token: 'b'.repeat(64) })).not.toBe(
      first,
    );
  });

  it('inclui a configuração de opções no fingerprint idempotente', async () => {
    const payload: CreatePublicOrderPayload = {
      menu_version_id: 'v1',
      operation_revision: 'r1',
      service_mode: 'pickup',
      payment_method: 'pix',
      customer: { name: 'Maria', phone: '11999999999' },
      items: [{ menu_item_id: 'item-1', quantity: 1, options: ['option-a', 'option-b'] }],
    };
    const samePayload = structuredClone(payload);
    const differentConfiguration: CreatePublicOrderPayload = {
      ...payload,
      items: [{ menu_item_id: 'item-1', quantity: 1, options: ['option-c'] }],
    };

    expect(await fingerprintOrderPayload(samePayload)).toBe(await fingerprintOrderPayload(payload));
    expect(await fingerprintOrderPayload(differentConfiguration)).not.toBe(
      await fingerprintOrderPayload(payload),
    );
  });

  it('gera segredo de recovery aleatório sem derivar PII do payload', () => {
    const first = createAttemptRecoveryHash();
    const second = createAttemptRecoveryHash();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });
});
