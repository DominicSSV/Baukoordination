'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { post } from '@/lib/client/api';

/**
 * Startbildschirm der App. Wer den Link zum ersten Mal öffnet, landet direkt hier
 * auf dem Code-Eingabefeld – nicht auf einer allgemeinen Startseite. Der Weg zum
 * Admin-Login ist bewusst klein und unauffällig (/admin).
 */
export default function SupplierLogin() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const value = code.trim();
    if (!value) {
      setError('Bitte gib deinen Zugangscode ein.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await post('/api/supplier/login', { code: value });
      router.replace('/app');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="stripe-bar" />
        <div className="auth-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-logo" src="/logo.png" alt="Swiss Solar Ventures AG" />
          <div className="eyebrow">Baukoordination</div>
          <h1>Als Lieferant anmelden</h1>
          <p>
            Gib den Zugangscode ein, den du per E-Mail von deinem Bauherrenvertreter
            erhalten hast. Du siehst danach nur die Projekte, für die du freigegeben bist.
          </p>

          <form onSubmit={submit}>
            <label htmlFor="login-code">Zugangscode</label>
            <input
              id="login-code"
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="z.B. A7K2M9"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoFocus
              maxLength={12}
              disabled={busy}
            />

            {error && <p className="auth-error">{error}</p>}

            <button
              type="submit"
              className="btn btn-accent"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={busy}
            >
              {busy ? 'Wird geprüft…' : 'Anmelden'}
            </button>
          </form>
        </div>
      </div>

      <p className="auth-alt">
        Bauherrenvertreter? <Link href="/admin">Hier anmelden</Link>
      </p>
    </div>
  );
}
