import { supabase } from '../supabase';

export type ServiceMode = 'pickup' | 'delivery';
export type PaymentMethodCode = 'cash' | 'pix' | 'credit_card' | 'debit_card';
export type OrderStatus =
  'new' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'refunded';

export type AdminOrderErrorCode = 'PED10' | 'PED11' | 'PED12' | 'PED46' | 'PED47' | 'PED48';

export type PublicOrderErrorCode =
  | 'PED33'
  | 'PED34'
  | 'PED35'
  | 'PED36'
  | 'PED37'
  | 'PED38'
  | 'PED39'
  | 'PED40'
  | 'PED41'
  | 'PED42'
  | 'PED43'
  | 'PED44'
  | 'PED45'
  | 'PED46'
  | 'PED47'
  | 'PED48'
  | 'PED49'
  | 'PED50'
  | 'PED51'
  | 'PED52'
  | 'PED72'
  | 'PED73'
  | 'PED74'
  | 'PED75'
  | 'PED76'
  | 'PED77'
  | 'PED78';

export const SERVICE_MODE_LABELS: Record<ServiceMode, string> = {
  pickup: 'Retirada',
  delivery: 'Entrega',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodCode, string> = {
  cash: 'Dinheiro',
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Novo',
  confirmed: 'Confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega',
  completed: 'Concluído',
  cancelled: 'Cancelado',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  paid: 'Pago',
  refunded: 'Reembolsado',
};

export const PUBLIC_ORDER_ERROR_MESSAGES: Record<PublicOrderErrorCode, string> = {
  PED33: 'Cardápio não encontrado.',
  PED34: 'Pedidos indisponíveis no momento.',
  PED35: 'O cardápio foi atualizado. Revise os itens antes de continuar.',
  PED36: 'O estabelecimento atualizou as condições do pedido. Revise antes de continuar.',
  PED37: 'Revise os itens do carrinho e tente novamente.',
  PED38: 'Um ou mais itens não estão disponíveis. Revise o cardápio.',
  PED39: 'A modalidade escolhida não está disponível.',
  PED40: 'A forma de pagamento escolhida não está disponível.',
  PED41: 'O valor mínimo do pedido ainda não foi atingido.',
  PED42: 'Os dados desta tentativa mudaram. Envie o pedido novamente.',
  PED43: 'Revise seu nome e telefone.',
  PED44: 'Revise o endereço de entrega.',
  PED45: 'Revise o valor informado para troco.',
  PED46: 'Pedido não encontrado.',
  PED47: 'Não foi possível atualizar o status do pedido.',
  PED48: 'Não foi possível atualizar o pagamento do pedido.',
  PED49: 'Não foi possível gerar o acompanhamento. Tente novamente.',
  PED50: 'O valor do pedido excede o limite permitido.',
  PED51: 'O Clube Ped-On está indisponível. Seus dados foram preservados.',
  PED52: 'A consulta do Clube expirou. Identifique-se novamente para acumular pontos.',
  PED72: 'Um grupo de opções não está mais disponível. Revise o carrinho.',
  PED73: 'A configuração de um item não é mais válida. Revise o carrinho.',
  PED74: 'Uma opção escolhida não foi encontrada. Revise o carrinho.',
  PED75: 'Uma opção escolhida ficou indisponível. Revise o carrinho antes de continuar.',
  PED76: 'Complete as opções obrigatórias antes de enviar o pedido.',
  PED77: 'Revise a quantidade de opções selecionadas em cada item.',
  PED78: 'Uma opção escolhida não pertence ao item ou cardápio atual. Revise o carrinho.',
};

export const ORDER_NETWORK_ERROR_MESSAGE =
  'Não foi possível confirmar o pedido. Verifique sua conexão e tente novamente.';

export const ADMIN_ORDER_ERROR_MESSAGES: Record<AdminOrderErrorCode, string> = {
  PED10: 'Sua sessão expirou. Entre novamente para continuar.',
  PED11: 'Você não tem permissão para acessar os pedidos desta unidade.',
  PED12: 'Unidade não encontrada.',
  PED46: 'Pedido não encontrado.',
  PED47: 'Este pedido foi atualizado. Recarregue os dados e tente novamente.',
  PED48: 'O pagamento foi atualizado. Recarregue os dados e tente novamente.',
};

export interface PublicOrderItemInput {
  menu_item_id: string;
  quantity: number;
  note?: string;
  options?: string[];
}

export interface PublicDeliveryAddressInput {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
  postal_code?: string;
  reference?: string;
}

export interface CreatePublicOrderPayload {
  menu_version_id: string;
  operation_revision: string;
  service_mode: ServiceMode;
  payment_method: PaymentMethodCode;
  customer: { name: string; phone: string };
  items: PublicOrderItemInput[];
  delivery_address?: PublicDeliveryAddressInput;
  notes?: string;
  cash_change_for?: string;
  loyalty_token?: string;
}

export interface CreatePublicOrderResult {
  order_number: number;
  tracking_token: string;
  tracking_path: string;
  service_mode: ServiceMode;
  payment_method: PaymentMethodCode;
  subtotal: string;
  delivery_fee: string;
  total: string;
  estimated_minutes: number | null;
  created_at: string;
}

export type OrderItemOptionKind = 'variation' | 'addon' | 'removal';

export interface PublicOrderTrackingOption {
  group_name: string;
  group_kind: OrderItemOptionKind;
  option_name: string;
  price_delta: string;
}

export interface PublicOrderTrackingItem {
  name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  options: PublicOrderTrackingOption[];
}

export interface PublicOrderTrackingFound {
  found: true;
  organization: { name: string };
  unit: { name: string };
  order: {
    order_number: number;
    status: OrderStatus;
    payment_status: PaymentStatus;
    service_mode: ServiceMode;
    payment_method: PaymentMethodCode;
    subtotal: string;
    delivery_fee: string;
    total: string;
    estimated_minutes: number | null;
    created_at: string;
    status_updated_at: string;
    completed_at: string | null;
    cancelled_at: string | null;
    items: PublicOrderTrackingItem[];
  };
}

export type PublicOrderTrackingResult = PublicOrderTrackingFound | { found: false };

export interface AdminOrderSummary {
  id: string;
  order_number: number;
  status: OrderStatus;
  payment_status: PaymentStatus;
  service_mode: ServiceMode;
  payment_method: PaymentMethodCode;
  item_count: number;
  subtotal: string;
  delivery_fee: string;
  total: string;
  estimated_minutes: number | null;
  customer_name: string;
  created_at: string;
  updated_at: string;
  status_updated_at: string;
  payment_status_updated_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  paid_at: string | null;
  refunded_at: string | null;
}

export interface AdminOrdersResult {
  unit: { id: string; name: string };
  status_filter: OrderStatus | null;
  count: number;
  orders: AdminOrderSummary[];
}

export interface AdminDeliveryAddress {
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  postal_code: string | null;
  reference: string | null;
}

export interface AdminOrderItemOption {
  id: string;
  group_id: string;
  group_name: string;
  group_kind: OrderItemOptionKind;
  option_id: string;
  option_name: string;
  price_delta: string;
}

export interface AdminOrderItem {
  id: string;
  menu_item_id: string;
  product_name: string;
  unit_price: string;
  quantity: number;
  line_total: string;
  note: string | null;
  options: AdminOrderItemOption[];
}

export interface AdminOrderEvent {
  id: string;
  event_type: 'created' | 'status_changed' | 'payment_changed';
  from_value: OrderStatus | PaymentStatus | null;
  to_value: OrderStatus | PaymentStatus;
  note: string | null;
  actor_type: 'customer' | 'staff' | 'system';
  actor_user_id: string | null;
  created_at: string;
}

export interface AdminOrderDetail extends AdminOrderSummary {
  organization_id: string;
  unit_id: string;
  menu_version_id: string;
  menu_version_number: number;
  tracking_token: string;
  tracking_path: string;
  customer_phone: string;
  delivery_address: AdminDeliveryAddress | null;
  cash_change_for: string | null;
  operation_revision: string;
  notes: string | null;
  items: AdminOrderItem[];
  events: AdminOrderEvent[];
}

type RpcError = { code?: string | null; message?: string; details?: string | null };

export class PublicOrderError extends Error {
  constructor(
    message: string,
    public readonly code: PublicOrderErrorCode | null,
    public readonly isNetworkError = false,
  ) {
    super(message);
    this.name = 'PublicOrderError';
  }
}

export class AdminOrderError extends Error {
  constructor(
    message: string,
    public readonly code: AdminOrderErrorCode | null,
  ) {
    super(message);
    this.name = 'AdminOrderError';
  }
}

export function extractPublicOrderError(error: RpcError): PublicOrderError {
  const content = `${error.code ?? ''} ${error.message ?? ''}`;
  const matched = content.match(/\bPED(?:3[3-9]|4\d|5[0-2]|7[2-8])\b/)?.[0] as
    PublicOrderErrorCode | undefined;
  if (matched !== undefined) {
    return new PublicOrderError(PUBLIC_ORDER_ERROR_MESSAGES[matched], matched);
  }

  const isNetworkError =
    error.code === undefined ||
    error.code === null ||
    error.code === '' ||
    /failed to fetch|fetch failed|network|load failed/i.test(error.message ?? '');
  return new PublicOrderError(
    isNetworkError
      ? ORDER_NETWORK_ERROR_MESSAGE
      : 'Não foi possível processar o pedido. Tente novamente.',
    null,
    isNetworkError,
  );
}

export function extractAdminOrderError(error: RpcError): AdminOrderError {
  const content = `${error.code ?? ''} ${error.message ?? ''}`;
  const matched = content.match(/\bPED(?:1[0-2]|4[6-8])\b/)?.[0] as AdminOrderErrorCode | undefined;
  if (matched !== undefined) {
    return new AdminOrderError(ADMIN_ORDER_ERROR_MESSAGES[matched], matched);
  }
  return new AdminOrderError(
    'Não foi possível carregar os pedidos. Verifique sua conexão e tente novamente.',
    null,
  );
}

async function adminOrderRpc<T>(name: string, parameters: Record<string, unknown>): Promise<T> {
  try {
    const { data, error } = await supabase.rpc(name, parameters);
    if (error) throw extractAdminOrderError(error);
    return data as T;
  } catch (error) {
    if (error instanceof AdminOrderError) throw error;
    throw extractAdminOrderError({
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}

export function unitOrdersPrefix(unitId: string) {
  return ['unit-orders', unitId] as const;
}

export function unitOrdersListPrefix(unitId: string) {
  return ['unit-orders', unitId, 'list'] as const;
}

export function unitOrdersListKey(unitId: string, status: OrderStatus | null) {
  return ['unit-orders', unitId, 'list', status ?? 'all'] as const;
}

export function unitOrderDetailKey(unitId: string, orderId: string) {
  return ['unit-orders', unitId, 'detail', orderId] as const;
}

export function fetchUnitOrdersAdmin(
  unitId: string,
  status: OrderStatus | null,
): Promise<AdminOrdersResult> {
  return adminOrderRpc('get_unit_orders_admin', {
    p_unit_id: unitId,
    p_status: status,
    p_limit: 100,
  });
}

export function fetchOrderAdmin(orderId: string): Promise<AdminOrderDetail> {
  return adminOrderRpc('get_order_admin', { p_order_id: orderId });
}

export function setOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
  note: string | null = null,
): Promise<AdminOrderDetail> {
  return adminOrderRpc('set_order_status', {
    p_order_id: orderId,
    p_next_status: nextStatus,
    p_note: note,
  });
}

export function setOrderPaymentStatus(
  orderId: string,
  paymentStatus: PaymentStatus,
): Promise<AdminOrderDetail> {
  return adminOrderRpc('set_order_payment_status', {
    p_order_id: orderId,
    p_payment_status: paymentStatus,
  });
}

export async function createPublicOrder(
  publicSlug: string,
  idempotencyKey: string,
  attemptHash: string,
  payload: CreatePublicOrderPayload,
): Promise<CreatePublicOrderResult> {
  try {
    const { data, error } = await supabase.rpc('create_public_order_v2', {
      p_public_slug: publicSlug,
      p_idempotency_key: idempotencyKey,
      p_attempt_hash: attemptHash,
      p_payload: payload,
    });
    if (error) throw extractPublicOrderError(error);
    return data as CreatePublicOrderResult;
  } catch (error) {
    if (error instanceof PublicOrderError) throw error;
    throw extractPublicOrderError({
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}

export type PublicOrderAttemptResult =
  ({ found: true } & CreatePublicOrderResult) | { found: false };

export async function getPublicOrderByAttempt(
  publicSlug: string,
  idempotencyKey: string,
  attemptHash: string,
): Promise<PublicOrderAttemptResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_order_by_attempt', {
      p_public_slug: publicSlug,
      p_idempotency_key: idempotencyKey,
      p_attempt_hash: attemptHash,
    });
    if (error) throw extractPublicOrderError(error);
    return (data as PublicOrderAttemptResult | null) ?? { found: false };
  } catch (error) {
    if (error instanceof PublicOrderError) throw error;
    throw extractPublicOrderError({
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}

export async function fetchPublicOrder(trackingToken: string): Promise<PublicOrderTrackingResult> {
  try {
    const { data, error } = await supabase.rpc('get_public_order', {
      p_tracking_token: trackingToken,
    });
    if (error) throw extractPublicOrderError(error);
    return (data as PublicOrderTrackingResult | null) ?? { found: false };
  } catch (error) {
    if (error instanceof PublicOrderError) throw error;
    throw extractPublicOrderError({
      message: error instanceof Error ? error.message : 'Network error',
    });
  }
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function publicOrderPollingInterval(
  result: PublicOrderTrackingResult | undefined,
): 15000 | false {
  return result?.found === true && !isTerminalOrderStatus(result.order.status) ? 15000 : false;
}
