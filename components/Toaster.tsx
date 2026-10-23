"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info" | "warn";

type Toast = {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
  action?: { label: string; onClick: () => void };
};

const ToastContext = createContext<{
  toast: (t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => void;
}>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const ICONS: Record<Tone, ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-ok" />,
  error: <XCircle className="h-4 w-4 text-dangerSoft" />,
  warn: <AlertTriangle className="h-4 w-4 text-warn" />,
  info: <Info className="h-4 w-4 text-info" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const toast = useCallback(
    (input: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => {
      const id = Date.now() + Math.random();
      const next: Toast = { id, tone: "info", ...input };
      setToasts((prev) => [...prev.slice(-3), next]);
      if (next.tone !== "error") setTimeout(() => dismiss(id), 5200);
    },
    [dismiss]
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[120] flex w-[min(380px,calc(100vw-40px))] flex-col gap-2.5">
        {toasts.map((t) => (
          <div key={t.id} className={cn("cc-card pointer-events-auto flex gap-3 p-3.5 pr-9", t.tone === "error" && "border-dangerSoft/30")}>
            <div className="mt-px shrink-0">{ICONS[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug text-foreground">{t.title}</div>
              {t.description && <div className="mt-1 text-[12px] leading-relaxed text-dim">{t.description}</div>}
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="mt-2 text-[12px] font-medium text-accentSoft underline-offset-2 hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="absolute right-2.5 top-2.5 rounded p-1 text-faint transition-colors hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
