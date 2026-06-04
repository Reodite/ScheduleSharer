import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

type PushToast = (text: string, kind?: 'info' | 'error') => void;

const ToastContext = createContext<PushToast>(() => {});

export function useToast(): PushToast {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const push = useCallback<PushToast>((text, kind = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5200 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' toast--error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
