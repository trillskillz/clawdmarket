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
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto px-5 py-3 rounded-lg text-sm font-medium shadow-xl backdrop-blur-sm animate-toast-in ${
              t.type === 'success'
                ? 'bg-green-500/90 text-white'
                : t.type === 'error'
                ? 'bg-red-500/90 text-white'
                : 'bg-bg2/95 text-text border border-border'
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
