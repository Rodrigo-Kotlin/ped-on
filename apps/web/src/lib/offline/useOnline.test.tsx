import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOnline, useOnline } from './useOnline';

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('assertOnline', () => {
  beforeEach(() => setNavigatorOnline(true));
  afterEach(() => setNavigatorOnline(true));

  it('não lança quando o navegador está online', () => {
    expect(() => assertOnline()).not.toThrow();
  });

  it('lança erro em português quando o navegador está offline', () => {
    setNavigatorOnline(false);
    expect(() => assertOnline()).toThrow('Você está offline');
  });
});

describe('useOnline', () => {
  beforeEach(() => setNavigatorOnline(true));

  it('inicia com o estado atual de conectividade', () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });

  it('reage ao evento online', async () => {
    setNavigatorOnline(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);

    setNavigatorOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('reage ao evento offline', async () => {
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);

    setNavigatorOnline(false);
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
