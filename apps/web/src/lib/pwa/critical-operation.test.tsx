import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CriticalOperationProvider, useCriticalOperation } from './critical-operation';

function LeaseProbe() {
  const { activeOperations } = useCriticalOperation();
  return <span aria-label="Leases ativas">{activeOperations}</span>;
}

function LeaseControls() {
  const { beginCriticalOperation } = useCriticalOperation();
  const firstReleaseRef = useRef<(() => void) | null>(null);
  const secondReleaseRef = useRef<(() => void) | null>(null);
  const [firstHeld, setFirstHeld] = useState(false);
  const [secondHeld, setSecondHeld] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          firstReleaseRef.current = beginCriticalOperation();
          setFirstHeld(true);
        }}
        disabled={firstHeld}
      >
        Iniciar primeira lease
      </button>
      <button
        type="button"
        onClick={() => {
          secondReleaseRef.current = beginCriticalOperation();
          setSecondHeld(true);
        }}
        disabled={secondHeld}
      >
        Iniciar segunda lease
      </button>
      <button
        type="button"
        onClick={() => {
          firstReleaseRef.current?.();
          firstReleaseRef.current?.();
          firstReleaseRef.current = null;
          setFirstHeld(false);
        }}
        disabled={!firstHeld}
      >
        Liberar primeira
      </button>
      <button
        type="button"
        onClick={() => {
          secondReleaseRef.current?.();
          secondReleaseRef.current = null;
          setSecondHeld(false);
        }}
        disabled={!secondHeld}
      >
        Liberar segunda
      </button>
      <LeaseProbe />
    </>
  );
}

describe('CriticalOperationProvider', () => {
  it('inicia com zero leases ativas', () => {
    render(
      <CriticalOperationProvider>
        <LeaseProbe />
      </CriticalOperationProvider>,
    );
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('0');
  });

  it('incrementa ao adquirir lease e libera de forma idempotente, nunca abaixo de zero', async () => {
    const user = userEvent.setup();
    render(
      <CriticalOperationProvider>
        <LeaseControls />
      </CriticalOperationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Iniciar primeira lease' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Liberar primeira' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Liberar primeira' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('0');
  });

  it('soma leases concorrentes e libera cada uma uma única vez', async () => {
    const user = userEvent.setup();
    render(
      <CriticalOperationProvider>
        <LeaseControls />
      </CriticalOperationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Iniciar primeira lease' }));
    await user.click(screen.getByRole('button', { name: 'Iniciar segunda lease' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('2');

    await user.click(screen.getByRole('button', { name: 'Liberar primeira' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'Liberar segunda' }));
    expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('0');
  });

  it('runCriticalOperation continua incrementando durante a operação e liberando ao concluir', async () => {
    const user = userEvent.setup();
    let resolveOperation!: () => void;
    function DeferredRun() {
      const { runCriticalOperation } = useCriticalOperation();
      return (
        <button
          type="button"
          onClick={() =>
            void runCriticalOperation(
              () => new Promise<void>((resolve) => (resolveOperation = resolve)),
            )
          }
        >
          Rodar operação
        </button>
      );
    }

    render(
      <CriticalOperationProvider>
        <DeferredRun />
        <LeaseProbe />
      </CriticalOperationProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Rodar operação' }));
    await waitFor(() => expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('1'));

    await act(async () => resolveOperation());
    await waitFor(() => expect(screen.getByLabelText('Leases ativas')).toHaveTextContent('0'));
  });
});
