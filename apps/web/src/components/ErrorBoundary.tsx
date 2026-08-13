import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.',
    };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erro capturado pelo ErrorBoundary:', error, info.componentStack);
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div role="alert" className="rounded-lg bg-red-50 p-5 text-red-800">
        <p className="font-semibold">Algo deu errado nesta tela.</p>
        <p className="mt-1 break-words text-sm">{this.state.message}</p>
        <button
          type="button"
          onClick={() => this.setState({ hasError: false, message: '' })}
          className="mt-3 min-h-11 rounded-md border border-red-300 px-4 font-semibold transition hover:bg-red-100"
        >
          Tentar novamente
        </button>
      </div>
    );
  }
}
