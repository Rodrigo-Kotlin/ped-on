import { renderWithProviders } from '@pedon/test-utils';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoundationPage } from './FoundationPage';

describe('FoundationPage', () => {
  it('apresenta a identidade do Ped-On', () => {
    renderWithProviders(<FoundationPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Ped-On' })).toBeInTheDocument();
    expect(screen.getByText('Gestão de Pedidos Inteligente')).toBeInTheDocument();
  });

  it('apresenta os tokens de marca', () => {
    renderWithProviders(<FoundationPage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Tokens de marca' })).toBeInTheDocument();
    expect(screen.getByText('Navy principal')).toBeInTheDocument();
    expect(screen.getByText('#081B2E')).toBeInTheDocument();
  });
});
