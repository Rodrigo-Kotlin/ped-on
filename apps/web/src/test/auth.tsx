import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { createTestQueryClient } from '@pedon/test-utils';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { AuthProvider } from '../lib/auth/AuthProvider';

export interface RenderWithAuthOptions {
  initialEntries?: string[];
}

export function renderWithAuth(ui: ReactElement, options: RenderWithAuthOptions = {}) {
  const { initialEntries = ['/'] } = options;
  const queryClient = createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper });
}
