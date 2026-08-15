import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assertOnline } from '../offline/useOnline';
import { useCriticalOperation } from '../pwa/critical-operation';
import type { AdminOrderDetail, AdminOrdersV2Result, OrderStatus, PaymentStatus } from './orders';
import {
  AdminOrderError,
  setOrderPaymentStatus,
  setOrderStatus,
  unitKdsPrefix,
  unitOrderDetailKey,
  unitOrdersListPrefix,
  unitOrdersV2ListPrefix,
} from './orders';

export function resetUnitOrdersSequence(queryClient: QueryClient, unitId: string): void {
  queryClient.setQueriesData<InfiniteData<AdminOrdersV2Result, string | null>>(
    { queryKey: unitOrdersV2ListPrefix(unitId) },
    (data) =>
      data === undefined
        ? undefined
        : { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) },
  );
}

function acceptOrderChange(
  queryClient: QueryClient,
  unitId: string,
  orderId: string,
  order: AdminOrderDetail,
): void {
  queryClient.setQueryData(unitOrderDetailKey(unitId, orderId), order);
  resetUnitOrdersSequence(queryClient, unitId);
  void queryClient.invalidateQueries({ queryKey: unitOrdersListPrefix(unitId) });
  void queryClient.invalidateQueries({ queryKey: unitKdsPrefix(unitId) });
}

function invalidateUnitOrderData(queryClient: QueryClient, unitId: string, orderId: string): void {
  void queryClient.invalidateQueries({ queryKey: unitOrdersListPrefix(unitId) });
  void queryClient.invalidateQueries({ queryKey: unitOrderDetailKey(unitId, orderId) });
  void queryClient.invalidateQueries({ queryKey: unitKdsPrefix(unitId) });
}

function isOrderConflict(error: unknown): boolean {
  return error instanceof AdminOrderError && (error.code === 'PED47' || error.code === 'PED48');
}

export function useOrderStatusMutation(unitId: string, orderId: string) {
  const queryClient = useQueryClient();
  const { runCriticalOperation } = useCriticalOperation();

  return useMutation({
    networkMode: 'always',
    mutationFn: (nextStatus: OrderStatus) => {
      assertOnline();
      return runCriticalOperation(() => setOrderStatus(orderId, nextStatus));
    },
    onSuccess: (order) => acceptOrderChange(queryClient, unitId, orderId, order),
    onError: (error) => {
      if (isOrderConflict(error)) invalidateUnitOrderData(queryClient, unitId, orderId);
    },
  });
}

export function useOrderPaymentMutation(unitId: string, orderId: string) {
  const queryClient = useQueryClient();
  const { runCriticalOperation } = useCriticalOperation();

  return useMutation({
    mutationFn: (paymentStatus: PaymentStatus) => {
      assertOnline();
      return runCriticalOperation(() => setOrderPaymentStatus(orderId, paymentStatus));
    },
    onSuccess: (order) => acceptOrderChange(queryClient, unitId, orderId, order),
    onError: (error) => {
      if (isOrderConflict(error)) invalidateUnitOrderData(queryClient, unitId, orderId);
    },
  });
}
