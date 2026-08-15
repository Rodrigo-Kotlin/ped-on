import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  elapsedMinutes,
  OPERATIONAL_CLOCK_INTERVAL_MS,
  remainingMinutes,
  useOperationalNow,
} from './useOperationalNow';

describe('operational clock', () => {
  afterEach(() => vi.useRealTimers());

  it('atualiza a cada 30 segundos com um único timer e limpa o interval', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-15T12:00:00.000Z'));
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const { result, unmount } = renderHook(() => useOperationalNow());

    expect(result.current).toBe(Date.parse('2026-08-15T12:00:00.000Z'));
    act(() => vi.advanceTimersByTime(OPERATIONAL_CLOCK_INTERVAL_MS));
    expect(result.current).toBe(Date.parse('2026-08-15T12:00:30.000Z'));

    unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });

  it('calcula idade e tempo restante somente para display', () => {
    const now = Date.parse('2026-08-15T12:20:30.000Z');
    expect(elapsedMinutes('2026-08-15T12:00:00.000Z', now)).toBe(20);
    expect(elapsedMinutes('2026-08-15T12:30:00.000Z', now)).toBe(0);
    expect(remainingMinutes('2026-08-15T12:31:00.000Z', now)).toBe(11);
    expect(remainingMinutes('2026-08-15T12:00:00.000Z', now)).toBe(0);
    expect(elapsedMinutes('invalid', now)).toBe(0);
  });
});
