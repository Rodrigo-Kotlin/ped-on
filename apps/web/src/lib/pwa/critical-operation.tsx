import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface CriticalOperationContextValue {
  activeOperations: number;
  beginCriticalOperation: () => () => void;
  runCriticalOperation: <T>(operation: () => Promise<T>) => Promise<T>;
}

const CriticalOperationContext = createContext<CriticalOperationContextValue>({
  activeOperations: 0,
  beginCriticalOperation: () => () => undefined,
  runCriticalOperation: (operation) => operation(),
});

export function CriticalOperationProvider({ children }: { children: ReactNode }) {
  const [activeOperations, setActiveOperations] = useState(0);

  function beginCriticalOperation() {
    setActiveOperations((current) => current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setActiveOperations((current) => Math.max(0, current - 1));
    };
  }

  async function runCriticalOperation<T>(operation: () => Promise<T>): Promise<T> {
    const release = beginCriticalOperation();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  return (
    <CriticalOperationContext
      value={{ activeOperations, beginCriticalOperation, runCriticalOperation }}
    >
      {children}
    </CriticalOperationContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCriticalOperation(): CriticalOperationContextValue {
  return useContext(CriticalOperationContext);
}
