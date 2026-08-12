import { z } from 'zod';
import { isPlainText } from '../plain-text';
import { supabase } from '../supabase';

const positiveBigintSchema = z.string().regex(/^[1-9][0-9]*$/);
const nonNegativeBigintSchema = z.string().regex(/^[0-9]+$/);
const rewardNameSchema = z.string().trim().min(1).max(120).refine(isPlainText);
const rewardDescriptionSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || isPlainText(value))
  .nullable();

export const loyaltyRewardSchema = z
  .object({
    id: z.string().min(1),
    organization_id: z.string().min(1),
    name: z.string(),
    description: z.string().nullable(),
    points_cost: positiveBigintSchema,
    stock_quantity: nonNegativeBigintSchema,
    is_active: z.boolean(),
    sort_order: z.number().int().positive(),
    created_at: z.string(),
    updated_at: z.string(),
    revision: z.string(),
  })
  .strict();

const loyaltyRewardsAdminSchema = z
  .object({
    organization_id: z.string().min(1),
    count: z.number().int().nonnegative(),
    has_more: z.boolean(),
    next_cursor: z.string().min(1).nullable(),
    rewards: z.array(loyaltyRewardSchema),
  })
  .strict();

export const createLoyaltyRewardSchema = z
  .object({
    name: rewardNameSchema,
    description: rewardDescriptionSchema,
    points_cost: positiveBigintSchema,
    initial_stock: nonNegativeBigintSchema,
  })
  .strict();

export const updateLoyaltyRewardSchema = z
  .object({
    name: rewardNameSchema.optional(),
    description: rewardDescriptionSchema.optional(),
    points_cost: positiveBigintSchema.optional(),
  })
  .strict()
  .refine(
    (payload) =>
      payload.name !== undefined ||
      payload.description !== undefined ||
      payload.points_cost !== undefined,
  );

const stockSchema = nonNegativeBigintSchema;

export type LoyaltyReward = z.infer<typeof loyaltyRewardSchema>;
export type LoyaltyRewardsAdmin = z.infer<typeof loyaltyRewardsAdminSchema>;
export type CreateLoyaltyRewardInput = z.infer<typeof createLoyaltyRewardSchema>;
export type UpdateLoyaltyRewardInput = z.infer<typeof updateLoyaltyRewardSchema>;

export type LoyaltyRewardAdminErrorCode =
  'PED10' | 'PED11' | 'PED53' | 'PED54' | 'PED63' | 'PED65' | 'PED66' | null;

export class LoyaltyRewardAdminError extends Error {
  constructor(
    message: string,
    public readonly code: LoyaltyRewardAdminErrorCode,
  ) {
    super(message);
    this.name = 'LoyaltyRewardAdminError';
  }
}

const ERROR_MESSAGES: Record<Exclude<LoyaltyRewardAdminErrorCode, null>, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Apenas o proprietário da organização pode gerenciar recompensas.',
  PED53: 'Inconsistência interna do Clube. Recarregue e tente novamente.',
  PED54: 'Esta recompensa não foi encontrada. Atualize a lista e tente novamente.',
  PED63: 'Revise os dados da recompensa e tente novamente.',
  PED65: 'Já existe uma recompensa com esse nome.',
  PED66: 'Informe um estoque válido, igual ou maior que zero.',
};

const FALLBACK_MESSAGE =
  'Não foi possível gerenciar as recompensas. Verifique sua conexão e tente novamente.';

function rewardError(error: unknown): LoyaltyRewardAdminError {
  if (error instanceof LoyaltyRewardAdminError) return error;
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : null;
  const code =
    typeof rawCode === 'string' && rawCode in ERROR_MESSAGES
      ? (rawCode as Exclude<LoyaltyRewardAdminErrorCode, null>)
      : null;
  return new LoyaltyRewardAdminError(code === null ? FALLBACK_MESSAGE : ERROR_MESSAGES[code], code);
}

async function rewardsRpc<T>(
  name: string,
  parameters: Record<string, unknown>,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(name, parameters);
    if (error) throw error;
    const result = responseSchema.safeParse(data);
    if (!result.success) {
      throw new LoyaltyRewardAdminError(
        'A resposta de recompensas é inválida. Recarregue e tente novamente.',
        null,
      );
    }
    return result.data;
  } catch (error) {
    throw rewardError(error);
  }
}

export function fetchLoyaltyRewardsAdmin(
  organizationId: string,
  cursor: string | null,
): Promise<LoyaltyRewardsAdmin> {
  return rewardsRpc(
    'get_loyalty_rewards_admin',
    { p_organization_id: organizationId, p_limit: 50, p_cursor: cursor },
    loyaltyRewardsAdminSchema,
  );
}

export function createLoyaltyReward(
  organizationId: string,
  input: CreateLoyaltyRewardInput,
): Promise<LoyaltyReward> {
  const payload = createLoyaltyRewardSchema.parse(input);
  return rewardsRpc(
    'create_loyalty_reward',
    { p_organization_id: organizationId, p_payload: payload },
    loyaltyRewardSchema,
  );
}

export function updateLoyaltyReward(
  rewardId: string,
  input: UpdateLoyaltyRewardInput,
): Promise<LoyaltyReward> {
  const payload = updateLoyaltyRewardSchema.parse(input);
  return rewardsRpc(
    'update_loyalty_reward',
    { p_reward_id: rewardId, p_payload: payload },
    loyaltyRewardSchema,
  );
}

export function setLoyaltyRewardActive(rewardId: string, active: boolean): Promise<LoyaltyReward> {
  return rewardsRpc(
    'set_loyalty_reward_active',
    { p_reward_id: rewardId, p_active: z.boolean().parse(active) },
    loyaltyRewardSchema,
  );
}

export function setLoyaltyRewardStock(rewardId: string, stock: string): Promise<LoyaltyReward> {
  return rewardsRpc(
    'set_loyalty_reward_stock',
    { p_reward_id: rewardId, p_stock: stockSchema.parse(stock) },
    loyaltyRewardSchema,
  );
}

export function loyaltyRewardsAdminKey(userId: string, organizationId: string) {
  return ['loyalty-rewards-admin', userId, organizationId] as const;
}
