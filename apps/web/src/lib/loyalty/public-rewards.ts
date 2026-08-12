import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import { supabase } from '../supabase';

const uuidSchema = z.string().uuid();
const pointsSchema = z.string().regex(/^\d+$/);
const revisionSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);

const publicRewardSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  points_cost: pointsSchema,
  available: z.boolean(),
  revision: revisionSchema,
});

const publicRewardsResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    loyalty_enabled: z.boolean(),
    rewards: z.array(publicRewardSchema),
  }),
]);

const publicRedemptionSchema = z.object({
  found: z.literal(true),
  redemption: z.object({
    reward_name: z.string(),
    points_cost: pointsSchema,
    created_at: z.string(),
  }),
  voucher: z.object({
    code: z.string().regex(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){3}$/),
    status: z.string(),
    issued_at: z.string(),
  }),
});

const publicRedemptionResultSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  publicRedemptionSchema,
]);

export type PublicReward = z.infer<typeof publicRewardSchema>;
export type PublicRewardsResult = z.infer<typeof publicRewardsResultSchema>;
export type PublicRedemption = z.infer<typeof publicRedemptionSchema>;
export type PublicRedemptionResult = z.infer<typeof publicRedemptionResultSchema>;

export type PublicRewardErrorCode =
  'PED52' | 'PED54' | 'PED55' | 'PED56' | 'PED57' | 'PED58' | 'PED59' | 'PED63' | 'PED64' | null;

const ERROR_MESSAGES: Record<Exclude<PublicRewardErrorCode, null>, string> = {
  PED52: 'Sua consulta expirou. Consulte seus pontos novamente.',
  PED54: 'Esta recompensa não está mais disponível.',
  PED55: 'Esta recompensa não está mais disponível.',
  PED56: 'A recompensa foi atualizada. Revise as novas condições antes de confirmar a troca.',
  PED57: 'Esta recompensa acabou de ficar indisponível.',
  PED58: 'Seu saldo não é suficiente para esta recompensa.',
  PED59: 'Não foi possível confirmar esta troca. Consulte seus vouchers.',
  PED63: 'Não foi possível processar esta recompensa.',
  PED64: 'Não foi possível emitir o voucher. Tente novamente.',
};

export class PublicRewardError extends Error {
  constructor(
    message: string,
    public readonly code: PublicRewardErrorCode,
  ) {
    super(message);
    this.name = 'PublicRewardError';
  }
}

type RpcError = { code?: string | null; message?: string; details?: string | null };

function rewardError(error: RpcError | undefined, fallback: string): PublicRewardError {
  const content = [error?.code, error?.message, error?.details].filter(Boolean).join(' ');
  const match = content.match(/\bPED(?:52|54|55|56|57|58|59|63|64)\b/)?.[0];
  const code = (match ?? null) as PublicRewardErrorCode;
  return new PublicRewardError(code === null ? fallback : ERROR_MESSAGES[code], code);
}

function invalidResponse(): PublicRewardError {
  return new PublicRewardError('Não foi possível validar a resposta do Clube Ped-On.', null);
}

function invalidRedemptionResponse(): PublicRewardError {
  return new PublicRewardError(
    'Não foi possível confirmar a troca. Consulte novamente para recuperar seu voucher.',
    null,
  );
}

export async function fetchPublicLoyaltyRewards(publicSlug: string): Promise<PublicRewardsResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_loyalty_rewards', {
      p_public_slug: publicSlug,
    });
    if (error) {
      throw rewardError(
        error,
        'Não foi possível carregar as recompensas. Verifique sua conexão e tente novamente.',
      );
    }
    const parsed = publicRewardsResultSchema.safeParse(data ?? { found: false });
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  } catch (error) {
    if (error instanceof PublicRewardError) throw error;
    throw rewardError(
      undefined,
      'Não foi possível carregar as recompensas. Verifique sua conexão e tente novamente.',
    );
  }
}

export function publicLoyaltyRewardsKey(publicSlug: string) {
  return ['public-loyalty-rewards', publicSlug] as const;
}

export function publicLoyaltyRewardsQueryOptions(publicSlug: string) {
  return queryOptions({
    queryKey: publicLoyaltyRewardsKey(publicSlug),
    queryFn: () => fetchPublicLoyaltyRewards(publicSlug),
    enabled: publicSlug !== '',
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}

export interface RedeemPublicRewardInput {
  publicSlug: string;
  idempotencyKey: string;
  rewardId: string;
  rewardRevision: string;
  accessToken: string;
  recoverySecret: string;
}

export async function redeemPublicLoyaltyReward(
  input: RedeemPublicRewardInput,
): Promise<PublicRedemption> {
  try {
    const { data, error } = await supabase.rpc('redeem_public_loyalty_reward', {
      p_public_slug: input.publicSlug,
      p_idempotency_key: input.idempotencyKey,
      p_reward_id: input.rewardId,
      p_reward_revision: input.rewardRevision,
      p_access_token: input.accessToken,
      p_recovery_secret: input.recoverySecret,
    });
    if (error) {
      throw rewardError(
        error,
        'Não foi possível concluir a troca. Verifique sua conexão e consulte novamente.',
      );
    }
    const parsed = publicRedemptionSchema.safeParse(data);
    if (!parsed.success) throw invalidRedemptionResponse();
    return parsed.data;
  } catch (error) {
    if (error instanceof PublicRewardError) throw error;
    throw rewardError(
      undefined,
      'Não foi possível concluir a troca. Verifique sua conexão e consulte novamente.',
    );
  }
}

export async function recoverPublicRedemption(input: {
  publicSlug: string;
  idempotencyKey: string;
  recoverySecret: string;
}): Promise<PublicRedemptionResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_redemption_by_attempt', {
      p_public_slug: input.publicSlug,
      p_idempotency_key: input.idempotencyKey,
      p_recovery_secret: input.recoverySecret,
    });
    if (error) {
      throw rewardError(
        error,
        'Não foi possível recuperar a troca. Verifique sua conexão e tente novamente.',
      );
    }
    const parsed = publicRedemptionResultSchema.safeParse(data ?? { found: false });
    if (!parsed.success) throw invalidResponse();
    return parsed.data;
  } catch (error) {
    if (error instanceof PublicRewardError) throw error;
    throw rewardError(
      undefined,
      'Não foi possível recuperar a troca. Verifique sua conexão e tente novamente.',
    );
  }
}

export function createRecoverySecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseRewardPoints(points: string): bigint {
  return BigInt(points);
}
