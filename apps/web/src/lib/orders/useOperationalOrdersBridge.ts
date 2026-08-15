import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnline } from '../offline/useOnline';
import { ORDER_ALERT_DISMISS_MS, OrderSeenTracker, processKdsOrdersForAlerts } from './orderAlerts';
import type { OrderAlertPayload } from './orderAlerts';
import { createOrderChimeApi } from './orderAlertsSound';
import { useKdsOrders } from './useKdsOrders';
import { subscribeToUnitOrders } from './useOrdersRealtime';
import type { OperationalRealtimeStatus } from './useOrdersRealtime';

export interface OperationalOrdersBridgeState {
  realtimeStatus: OperationalRealtimeStatus;
  newCount: number;
  alert: OrderAlertPayload | null;
  dismissAlert: () => void;
  soundEnabled: boolean;
  soundUnavailable: boolean;
  toggleSound: () => void;
}

export function useOperationalOrdersBridge(unitId: string | null): OperationalOrdersBridgeState {
  const online = useOnline();
  const queryClient = useQueryClient();
  const kdsQuery = useKdsOrders(unitId ?? '', { enabled: unitId !== null });

  const [realtimeStatus, setRealtimeStatus] = useState<OperationalRealtimeStatus>('connecting');
  const [newCount, setNewCount] = useState(0);
  const [alert, setAlert] = useState<OrderAlertPayload | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [soundUnavailable, setSoundUnavailable] = useState(false);

  const seenTrackerRef = useRef<OrderSeenTracker>(new OrderSeenTracker());
  const baselineUnitsRef = useRef(new Set<string>());
  const resyncRef = useRef(false);
  const wasErrorRef = useRef(false);
  const wasOnlineRef = useRef(online);
  const realtimeStatusRef = useRef<OperationalRealtimeStatus>('connecting');
  const intentionalCloseRef = useRef(false);
  const soundEnabledRef = useRef(false);
  const audioApiRef = useRef<ReturnType<typeof createOrderChimeApi>>(null);
  const dismissTimerRef = useRef<number | null>(null);
  const previousUnitRef = useRef<string | null>(null);

  const clearDismissTimer = useCallback(() => {
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, []);

  const dismissAlert = useCallback(() => {
    clearDismissTimer();
    setAlert(null);
  }, [clearDismissTimer]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    realtimeStatusRef.current = realtimeStatus;
  }, [realtimeStatus]);

  useEffect(() => {
    if (unitId === null) return undefined;
    if (unitId !== previousUnitRef.current) {
      previousUnitRef.current = unitId;
      setNewCount(0);
      dismissAlert();
    }
    intentionalCloseRef.current = false;
    resyncRef.current = true;
    const cleanup = subscribeToUnitOrders(unitId, queryClient, (status) => {
      if (intentionalCloseRef.current) return;
      const previous = realtimeStatusRef.current;
      setRealtimeStatus(status);
      if (status === 'connected' && previous === 'degraded') {
        resyncRef.current = true;
      }
    });
    return () => {
      intentionalCloseRef.current = true;
      cleanup();
    };
  }, [queryClient, unitId, dismissAlert]);

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearDismissTimer();
      audioApiRef.current?.close();
      audioApiRef.current = null;
    };
  }, [clearDismissTimer]);

  useEffect(() => {
    if (!wasOnlineRef.current && online) {
      resyncRef.current = true;
    }
    wasOnlineRef.current = online;
  }, [online]);

  const toggleSound = useCallback(() => {
    if (soundEnabledRef.current) {
      audioApiRef.current?.close();
      audioApiRef.current = null;
      setSoundEnabled(false);
      return;
    }
    const api = createOrderChimeApi();
    if (api === null) {
      setSoundUnavailable(true);
      setSoundEnabled(false);
      return;
    }
    audioApiRef.current = api;
    setSoundUnavailable(false);
    setSoundEnabled(true);
  }, []);

  useEffect(() => {
    if (kdsQuery.isError) {
      wasErrorRef.current = true;
      return;
    }
    if (kdsQuery.data === undefined || kdsQuery.data === null || unitId === null) return;
    const orders = kdsQuery.data.orders;
    if (!Array.isArray(orders)) return;

    if (wasErrorRef.current) {
      resyncRef.current = true;
      wasErrorRef.current = false;
    }

    const resync = resyncRef.current;
    resyncRef.current = false;
    const isBaseline = !baselineUnitsRef.current.has(unitId) || resync;
    if (isBaseline) baselineUnitsRef.current.add(unitId);

    const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
    const result = processKdsOrdersForAlerts({
      unitId,
      orders,
      baseline: isBaseline,
      visible,
      soundEnabled: soundEnabledRef.current,
      seenTracker: seenTrackerRef.current,
    });

    setNewCount(result.newCount);
    if (result.alert === null) return;

    setAlert(result.alert);
    clearDismissTimer();
    dismissTimerRef.current = window.setTimeout(() => setAlert(null), ORDER_ALERT_DISMISS_MS);

    if (result.shouldPlaySound) {
      const api = audioApiRef.current;
      if (api !== null && !api.play()) {
        api.close();
        audioApiRef.current = null;
        setSoundEnabled(false);
      }
    }
  }, [kdsQuery.data, kdsQuery.isError, unitId, clearDismissTimer]);

  return {
    realtimeStatus,
    newCount,
    alert,
    dismissAlert,
    soundEnabled,
    soundUnavailable,
    toggleSound,
  };
}
