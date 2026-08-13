import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface CriticalOperationContextValue {
  activeOperations: number;
  runCriticalOperation: <T>(operation: () => Promise<T>) => Promise<T>;
}

const CriticalOperationContext = createContext<CriticalOperationContextValue>({
  activeOperations: 0,
  runCriticalOperation: (operation) => operation(),
});

export function CriticalOperationProvider({ children }: { children: ReactNode }) {
  const [activeOperations, setActiveOperations] = useState(0);

  async function runCriticalOperation<T>(operation: () => Promise<T>): Promise<T> {
    setActiveOperations((current) => current + 1);
    try {
      return await operation();
    } finally {
      setActiveOperations((current) => Math.max(0, current - 1));
    }
  }

  return (
    <CriticalOperationContext value={{ activeOperations, runCriticalOperation }}>
      {children}
    </CriticalOperationContext>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCriticalOperation(): CriticalOperationContextValue {
  return useContext(CriticalOperationContext);
}
