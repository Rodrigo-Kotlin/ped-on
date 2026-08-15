import { describe, expect, it } from 'vitest';
import {
  containsForbiddenRuntimeCaching,
  FORBIDDEN_RUNTIME_CACHING_PATTERN,
} from './audit-precache-runtime-caching.mjs';

const precacheOnlySw = `self.__WB_MANIFEST=[{"revision":"a1b2c3","url":"assets/supabase-AbCd1234.js"},{"revision":"d4e5f6","url":"assets/index-DEadBeef.js"}];precacheAndRoute(self.__WB_MANIFEST);`;

describe('audit-precache runtime caching detection', () => {
  it('CASO A: chunk precacheado assets/supabase-<hash>.js NÃO é runtime caching', () => {
    expect(containsForbiddenRuntimeCaching(precacheOnlySw)).toBe(false);
  });

  it('CASO B: endpoint real supabase.co/rest/v1 continua bloqueado', () => {
    const sw = `${precacheOnlySw}new NetworkOnly({urlPattern: 'https://abc.supabase.co/rest/v1/.*'})`;
    expect(containsForbiddenRuntimeCaching(sw)).toBe(true);
  });

  it('endpoint functions/v1 continua bloqueado', () => {
    expect(containsForbiddenRuntimeCaching(`${precacheOnlySw}functions/v1`)).toBe(true);
  });

  it('workbox NetworkFirst continua bloqueado', () => {
    expect(containsForbiddenRuntimeCaching(`${precacheOnlySw}new NetworkFirst({})`)).toBe(true);
  });

  it('workbox StaleWhileRevalidate continua bloqueado', () => {
    expect(containsForbiddenRuntimeCaching(`${precacheOnlySw}new StaleWhileRevalidate({})`)).toBe(
      true,
    );
  });

  it('mantém detecção real mesmo com chunk supabase-*.js presente', () => {
    const sw = `${precacheOnlySw}supabase.co/rest/v1`;
    expect(containsForbiddenRuntimeCaching(sw)).toBe(true);
  });

  it('padrão não casa chunk supabase-*.js nem URLs locais de asset', () => {
    expect('assets/supabase-BrDSjFgg.js'.match(FORBIDDEN_RUNTIME_CACHING_PATTERN)).toBeNull();
    expect('assets/index-DEadBeef.js'.match(FORBIDDEN_RUNTIME_CACHING_PATTERN)).toBeNull();
    expect('assets/workbox-2fbc6a65.js'.match(FORBIDDEN_RUNTIME_CACHING_PATTERN)).toBeNull();
  });
});
