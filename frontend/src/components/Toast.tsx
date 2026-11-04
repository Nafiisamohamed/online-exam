'use client';
/** Success / error / warning notifications (toasts) shown at the top-right (bottom on phones). */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}

const Ctx = createContext<((kind: Kind, text: string) => void) | null>(null);

const STYLE: Record<Kind, string> = {
  success: 'border-brand-600 bg-brand-50 text-brand-900',
  error: 'border-red-500 bg-red-50 text-red-900',
  warning: 'border-amber-500 bg-amber-50 text-amber-900',
  info: 'border-gray-400 bg-white text-gray-900',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 4000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto w-full max-w-sm rounded-lg border-l-4 px-4 py-3 text-sm shadow-lg ${STYLE[t.kind]}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error('useToast must be used inside ToastProvider');
  return {
    success: (text: string) => push('success', text),
    error: (text: string) => push('error', text),
    warning: (text: string) => push('warning', text),
    info: (text: string) => push('info', text),
  };
}
