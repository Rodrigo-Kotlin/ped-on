import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import {
  createRecoverySecret,
  fetchPublicLoyaltyRewards,
  publicLoyaltyRewardsKey,
  PublicRewardError,
  recoverPublicRedemption,
  redeemPublicLoyaltyReward,
} from './public-rewards';

const reward = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Café grátis',
  description: 'Um café da casa',
  points_cost: '80',
  available: true,
  revision: '2026-08-11T12:00:00.123456Z',
};

const redemption = {
  found: true,
  redemption: { reward_name: 'Café grátis', points_cost: '80', created_at: '2026-08-11T13:00:00Z' },
  voucher: { code: 'ABCD-EF12-3456-7890', status: 'issued', issued_at: '2026-08-11T13:00:00Z' },
};

describe('public loyalty rewards RPCs', () => {
  beforeEach(resetSupabaseMock);

  it('uses a query key containing only its public slug and validates the catalog', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { found: true, loyalty_enabled: true, rewards: [reward] },
      error: null,
    });

    expect(publicLoyaltyRewardsKey('slug-only')).toEqual(['public-loyalty-rewards', 'slug-only']);
    await expect(fetchPublicLoyaltyRewards('slug-only')).resolves.toMatchObject({
      rewards: [reward],
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_loyalty_rewards', {
      p_public_slug: 'slug-only',
    });
  });

  it('rejects an invalid new RPC response', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: { found: true, loyalty_enabled: true, rewards: [{ ...reward, points_cost: 80 }] },
      error: null,
    });

    await expect(fetchPublicLoyaltyRewards('slug')).rejects.toBeInstanceOf(PublicRewardError);
  });

  it('redeems with identifiers, exact revision, token and recovery secret but no points cost', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: redemption, error: null });
    const input = {
      publicSlug: 'slug',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      rewardId: reward.id,
      rewardRevision: reward.revision,
      accessToken: 'a'.repeat(64),
      recoverySecret: 'b'.repeat(64),
    };

    await expect(redeemPublicLoyaltyReward(input)).resolves.toEqual(redemption);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('redeem_public_loyalty_reward', {
      p_public_slug: input.publicSlug,
      p_idempotency_key: input.idempotencyKey,
      p_reward_id: input.rewardId,
      p_reward_revision: input.rewardRevision,
      p_access_token: input.accessToken,
      p_recovery_secret: input.recoverySecret,
    });
    expect(supabaseMock.rpc.mock.calls[0]?.[1]).not.toHaveProperty('p_points_cost');
  });

  it('recovers a voucher using only the persisted attempt secrets', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: redemption, error: null });
    await expect(
      recoverPublicRedemption({
        publicSlug: 'slug',
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
        recoverySecret: 'b'.repeat(64),
      }),
    ).resolves.toEqual(redemption);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_public_redemption_by_attempt', {
      p_public_slug: 'slug',
      p_idempotency_key: '22222222-2222-4222-8222-222222222222',
      p_recovery_secret: 'b'.repeat(64),
    });
  });

  it.each([
    'PED33',
    'PED51',
    'PED52',
    'PED53',
    'PED54',
    'PED55',
    'PED56',
    'PED57',
    'PED58',
    'PED59',
    'PED63',
    'PED64',
  ] as const)('maps deterministic redemption error %s without retrying', async (code) => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code, message: 'deterministic' } });
    const error = await redeemPublicLoyaltyReward({
      publicSlug: 'slug',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      rewardId: reward.id,
      rewardRevision: reward.revision,
      accessToken: 'a'.repeat(64),
      recoverySecret: 'b'.repeat(64),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublicRewardError);
    expect((error as PublicRewardError).code).toBe(code);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
  });

  it('creates a random lowercase 64-hex recovery secret', () => {
    const first = createRecoverySecret();
    const second = createRecoverySecret();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
  });
});
