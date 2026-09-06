"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  tone: "error" | "success" | "info";
}

const ToastCtx = createContext<{ push: (message: string, tone?: Toast["tone"]) => void }>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastCtx);
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "error") => {
    const id = nextId++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="font-mono"
            style={{
              padding: "10px 14px",
              fontSize: 12,
              border: "1px solid",
              background: "#fff",
              borderColor: t.tone === "error" ? "var(--lp-red-border)" : t.tone === "success" ? "var(--lp-green-border)" : "var(--lp-border)",
              color: t.tone === "error" ? "var(--lp-red)" : t.tone === "success" ? "var(--lp-green)" : "var(--lp-fg)",
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
