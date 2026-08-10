'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ConfirmRequest = {
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

type FeedbackApi = {
  /** Kurze Meldung am unteren Bildschirmrand. */
  toast: (message: string, kind?: 'info' | 'error') => void;
  /** Sichtbare Fehlermeldung – nie stumm scheitern lassen. */
  reportError: (error: unknown, fallback?: string) => void;
  /** Eigener Bestätigungsdialog statt window.confirm(). */
  confirm: (
    message: string,
    onConfirm: () => void | Promise<void>,
    confirmLabel?: string,
  ) => void;
};

const FeedbackContext = createContext<FeedbackApi | null>(null);

export function useFeedback(): FeedbackApi {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useFeedback muss innerhalb von <FeedbackProvider> stehen.');
  return ctx;
}

/**
 * Führt Toasts und Bestätigungsdialoge zusammen. Beides bewusst selbst gebaut statt
 * alert()/confirm() – so bleibt das Erscheinungsbild konsistent (Punkt 8 der Spezifikation).
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ text: string; kind: 'info' | 'error' } | null>(
    null,
  );
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setMessage({ text, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), kind === 'error' ? 7000 : 4000);
  }, []);

  const reportError = useCallback(
    (error: unknown, fallback = 'Die Aktion ist fehlgeschlagen.') => {
      const text = error instanceof Error && error.message ? error.message : fallback;
      console.error('[baukoordination]', error);
      toast(`⚠️ ${text}`, 'error');
    },
    [toast],
  );

  const confirm = useCallback(
    (
      msg: string,
      onConfirm: () => void | Promise<void>,
      confirmLabel = 'Ja, löschen',
    ) => {
      setRequest({ message: msg, onConfirm, confirmLabel });
    },
    [],
  );

  const api = useMemo<FeedbackApi>(
    () => ({ toast, reportError, confirm }),
    [toast, reportError, confirm],
  );

  async function runConfirm() {
    if (!request) return;
    setBusy(true);
    try {
      await request.onConfirm();
      setRequest(null);
    } catch (error) {
      setRequest(null);
      reportError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FeedbackContext.Provider value={api}>
      {children}

      {request && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setRequest(null);
          }}
        >
          <div className="modal" style={{ maxWidth: 420 }}>
            <h3 style={{ fontSize: 17 }}>Sicher?</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{request.message}</p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-danger btn-sm"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={runConfirm}
                disabled={busy}
              >
                {busy ? 'Einen Moment…' : request.confirmLabel}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setRequest(null)}
                disabled={busy}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`toast ${message ? 'show' : ''} ${message?.kind === 'error' ? 'error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {message?.text ?? ''}
      </div>
    </FeedbackContext.Provider>
  );
}
