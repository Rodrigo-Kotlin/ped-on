import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () =>
  import('../../test/supabaseMock').then((module) => ({ supabase: module.supabaseMock })),
);

import { resetSupabaseMock, supabaseMock } from '../../test/supabaseMock';
import {
  createLoyaltyReward,
  fetchLoyaltyRewardsAdmin,
  loyaltyRewardsAdminKey,
  LoyaltyRewardAdminError,
  setLoyaltyRewardActive,
  setLoyaltyRewardStock,
  updateLoyaltyReward,
} from './admin-rewards';

const reward = {
  id: 'reward-1',
  organization_id: 'org-1',
  name: 'Café grátis',
  description: 'Um café coado',
  points_cost: '9007199254740993',
  stock_quantity: '9007199254740995',
  is_active: true,
  sort_order: 1,
  created_at: '2026-08-11T10:00:00Z',
  updated_at: '2026-08-11T10:00:00Z',
  revision: '2026-08-11T10:00:00.000000Z',
};

describe('admin rewards RPC clients', () => {
  beforeEach(() => resetSupabaseMock());

  it('consulta recompensas com paginação e preserva bigints como strings exatas', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        organization_id: 'org-1',
        count: 1,
        has_more: false,
        next_cursor: null,
        rewards: [reward],
      },
      error: null,
    });

    const result = await fetchLoyaltyRewardsAdmin('org-1', null);

    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_loyalty_rewards_admin', {
      p_organization_id: 'org-1',
      p_limit: 50,
      p_cursor: null,
    });
    expect(result.rewards[0]?.points_cost).toBe('9007199254740993');
    expect(result.rewards[0]?.stock_quantity).toBe('9007199254740995');
  });

  it('envia somente os contratos permitidos para criar e atualizar', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: reward, error: null });

    await createLoyaltyReward('org-1', {
      name: 'Café grátis',
      description: null,
      points_cost: '100',
      initial_stock: '0',
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('create_loyalty_reward', {
      p_organization_id: 'org-1',
      p_payload: {
        name: 'Café grátis',
        description: null,
        points_cost: '100',
        initial_stock: '0',
      },
    });

    await updateLoyaltyReward('reward-1', {
      name: 'Café especial',
      description: 'Novo texto',
      points_cost: '150',
    });
    expect(supabaseMock.rpc).toHaveBeenCalledWith('update_loyalty_reward', {
      p_reward_id: 'reward-1',
      p_payload: {
        name: 'Café especial',
        description: 'Novo texto',
        points_cost: '150',
      },
    });
  });

  it('envia estoque decimal como string e estado ativo em RPCs separadas', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: reward, error: null });

    await setLoyaltyRewardStock('reward-1', '9007199254740995');
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_loyalty_reward_stock', {
      p_reward_id: 'reward-1',
      p_stock: '9007199254740995',
    });

    await setLoyaltyRewardActive('reward-1', false);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('set_loyalty_reward_active', {
      p_reward_id: 'reward-1',
      p_active: false,
    });
  });

  it.each([
    ['PED10', 'sessão expirou'],
    ['PED11', 'proprietário'],
    ['PED53', 'Inconsistência interna'],
    ['PED54', 'não foi encontrada'],
    ['PED63', 'Revise os dados'],
    ['PED65', 'Já existe'],
    ['PED66', 'estoque válido'],
  ])('mapeia %s para uma mensagem amigável', async (code, fragment) => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code, message: 'DB' } });
    const error = await fetchLoyaltyRewardsAdmin('org-1', null).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoyaltyRewardAdminError);
    expect((error as Error).message).toContain(fragment);
  });

  it('rejeita bigints numéricos e campos extras na resposta', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        organization_id: 'org-1',
        count: 1,
        has_more: false,
        next_cursor: null,
        rewards: [{ ...reward, points_cost: 100, unexpected: true }],
      },
      error: null,
    });

    await expect(fetchLoyaltyRewardsAdmin('org-1', null)).rejects.toThrow(
      'resposta de recompensas é inválida',
    );
  });

  it('rejeita entradas bigint fora do formato decimal antes da RPC', async () => {
    expect(() => setLoyaltyRewardStock('reward-1', '-1')).toThrow();
    expect(() =>
      createLoyaltyReward('org-1', {
        name: 'Café',
        description: null,
        points_cost: '1e3',
        initial_stock: '0',
      }),
    ).toThrow();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it('gera chave segregada apenas por usuário e organização', () => {
    expect(loyaltyRewardsAdminKey('user-1', 'org-1')).toEqual([
      'loyalty-rewards-admin',
      'user-1',
      'org-1',
    ]);
  });
});
