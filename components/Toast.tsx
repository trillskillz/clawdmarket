'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-[300] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto min-w-0 break-words [overflow-wrap:anywhere] px-5 py-3 rounded-lg border bg-bg2 text-sm font-medium shadow-xl animate-toast-in ${
              t.type === 'success'
                ? 'border-green-300/40 text-green-300'
                : t.type === 'error'
                ? 'border-red-300/40 text-red-300'
                : 'text-text border-border'
            }`}
          >
            {t.type === 'success' && '✅ '}
            {t.type === 'error' && '❌ '}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
