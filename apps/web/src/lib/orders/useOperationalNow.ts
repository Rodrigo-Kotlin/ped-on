import { useEffect, useState } from 'react';

export const OPERATIONAL_CLOCK_INTERVAL_MS = 30_000;

export function useOperationalNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), OPERATIONAL_CLOCK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

export function elapsedMinutes(timestamp: string, now: number): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor((now - value) / 60_000));
}

export function remainingMinutes(timestamp: string, now: number): number {
  const value = Date.parse(timestamp);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.ceil((value - now) / 60_000));
}
