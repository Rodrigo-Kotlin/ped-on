import type { KdsOrder } from './orders';

export const ORDER_SEEN_LIMIT_PER_UNIT = 1000;

export const ORDER_ALERT_DISMISS_MS = 10_000;

export interface OrderAlertPayload {
  unitId: string;
  count: number;
  orderNumbers: number[];
}

export interface KdsAlertProcessResult {
  newCount: number;
  alert: OrderAlertPayload | null;
  shouldPlaySound: boolean;
}

export function orderAlertMessage(alert: OrderAlertPayload): string {
  if (alert.count === 1 && alert.orderNumbers[0] !== undefined) {
    return `Novo pedido #${alert.orderNumbers[0]} recebido.`;
  }
  return `${alert.count} novos pedidos recebidos.`;
}

export class OrderSeenTracker {
  private readonly seenByUnit = new Map<string, Set<string>>();

  has(unitId: string, orderId: string): boolean {
    return this.seenByUnit.get(unitId)?.has(orderId) === true;
  }

  size(unitId: string): number {
    return this.seenByUnit.get(unitId)?.size ?? 0;
  }

  markSeen(unitId: string, orderIds: readonly string[]): void {
    let seen = this.seenByUnit.get(unitId);
    if (seen === undefined) {
      seen = new Set();
      this.seenByUnit.set(unitId, seen);
    }
    for (const orderId of orderIds) {
      seen.add(orderId);
    }
    this.prune(seen);
  }

  private prune(seen: Set<string>): void {
    if (seen.size <= ORDER_SEEN_LIMIT_PER_UNIT) return;
    const overflow = seen.size - ORDER_SEEN_LIMIT_PER_UNIT;
    let removed = 0;
    for (const orderId of seen) {
      seen.delete(orderId);
      removed += 1;
      if (removed >= overflow) break;
    }
  }
}

export function processKdsOrdersForAlerts(options: {
  unitId: string;
  orders: KdsOrder[];
  baseline: boolean;
  visible: boolean;
  soundEnabled: boolean;
  seenTracker: OrderSeenTracker;
}): KdsAlertProcessResult {
  const { unitId, orders, baseline, visible, soundEnabled, seenTracker } = options;

  const currentNew = orders.filter((order) => order.status === 'new');
  const currentNewIds = new Set(currentNew.map((order) => order.id));
  const unseenNew = currentNew.filter((order) => !seenTracker.has(unitId, order.id));
  const allOrderIds = orders.map((order) => order.id);
  seenTracker.markSeen(unitId, allOrderIds);

  if (baseline) {
    return { newCount: currentNewIds.size, alert: null, shouldPlaySound: false };
  }

  if (unseenNew.length === 0) {
    return { newCount: currentNewIds.size, alert: null, shouldPlaySound: false };
  }
  if (!visible) {
    return { newCount: currentNewIds.size, alert: null, shouldPlaySound: false };
  }

  const orderNumbers = unseenNew.map((order) => order.order_number).sort((a, b) => a - b);
  return {
    newCount: currentNewIds.size,
    alert: { unitId, count: unseenNew.length, orderNumbers },
    shouldPlaySound: soundEnabled,
  };
}
