"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type ToastTone = "success" | "error" | "info";

type ToastInput = {
  title?: string;
  message: string;
  tone?: ToastTone;
  durationMs?: number;
};

type ToastRecord = {
  id: number;
  title?: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => number;
  success: (message: string, options?: Omit<ToastInput, "message" | "tone">) => number;
  error: (message: string, options?: Omit<ToastInput, "message" | "tone">) => number;
  info: (message: string, options?: Omit<ToastInput, "message" | "tone">) => number;
  dismissToast: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS: Record<ToastTone, number> = {
  success: 2800,
  error: 4800,
  info: 3200,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextIdRef = useRef(1);
  const timeoutMapRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismissToast = useCallback((id: number) => {
    const timeout = timeoutMapRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutMapRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = nextIdRef.current++;
      const tone = toast.tone ?? "info";
      const durationMs = toast.durationMs ?? DEFAULT_DURATION_MS[tone];
      const record: ToastRecord = {
        id,
        title: toast.title,
        message: toast.message,
        tone,
        durationMs,
      };

      setToasts((current) => [...current, record]);

      if (durationMs > 0) {
        const timeout = setTimeout(() => {
          dismissToast(id);
        }, durationMs);
        timeoutMapRef.current.set(id, timeout);
      }

      return id;
    },
    [dismissToast]
  );

  const success = useCallback(
    (message: string, options?: Omit<ToastInput, "message" | "tone">) =>
      showToast({ ...options, message, tone: "success" }),
    [showToast]
  );

  const error = useCallback(
    (message: string, options?: Omit<ToastInput, "message" | "tone">) =>
      showToast({ ...options, message, tone: "error" }),
    [showToast]
  );

  const info = useCallback(
    (message: string, options?: Omit<ToastInput, "message" | "tone">) =>
      showToast({ ...options, message, tone: "info" }),
    [showToast]
  );

  useEffect(() => {
    return () => {
      timeoutMapRef.current.forEach((timeout) => clearTimeout(timeout));
      timeoutMapRef.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
      success,
      error,
      info,
      dismissToast,
    }),
    [dismissToast, error, info, showToast, success]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="ui-toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`ui-toast ui-toast--${toast.tone}`}
            role={toast.tone === "error" ? "alert" : "status"}
          >
            <div className="ui-toast__body">
              {toast.title && <div className="ui-toast__title">{toast.title}</div>}
              <div className="ui-toast__message">{toast.message}</div>
            </div>
            <button
              type="button"
              className="ui-toast__close"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return value;
}
