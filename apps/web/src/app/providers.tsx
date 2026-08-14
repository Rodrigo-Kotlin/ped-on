import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { PwaUpdatePrompt } from '../components/PwaUpdatePrompt';
import { AuthProvider } from '../lib/auth/AuthProvider';
import { sanitizeStoredCarts } from '../lib/cart/cart';
import { CriticalOperationProvider } from '../lib/pwa/critical-operation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    sanitizeStoredCarts();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <CriticalOperationProvider>
        <AuthProvider>{children}</AuthProvider>
        <PwaUpdatePrompt />
      </CriticalOperationProvider>
    </QueryClientProvider>
  );
}
