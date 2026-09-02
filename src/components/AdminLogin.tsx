'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { post } from '@/lib/client/api';
import { zielNachAnmeldung } from '@/lib/client/ziel';

type Mode = 'password' | 'magic';

/**
 * Echter Supabase-Auth-Login für den Bauherrenvertreter – bewusst kein geteilter
 * Geheim-Code mehr wie im Prototyp.
 */
export default function AdminLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const ziel = zielNachAnmeldung();

    setBusy(true);
    setError('');
    setNote('');

    try {
      const supabase = browserClient();

      if (mode === 'magic') {
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(ziel)}`,
          },
        });
        if (otpError) throw new Error(otpError.message);
        setNote(
          `Anmeldelink an ${email.trim()} verschickt. Bitte E-Mail öffnen und dem Link folgen.`,
        );
        setBusy(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        throw new Error(
          signInError.message === 'Invalid login credentials'
            ? 'E-Mail oder Passwort stimmt nicht.'
            : signInError.message,
        );
      }

      // Eine eventuell noch offene Lieferanten-Sitzung im selben Browser beenden,
      // sonst hätte sie Vorrang vor der Adminsicht.
      await post('/api/supplier/logout').catch(() => undefined);

      router.replace(ziel);
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
          <h1>Anmeldung Bauherrenvertreter</h1>
          <p>
            {mode === 'password'
              ? 'Melde dich mit deiner E-Mail-Adresse und deinem Passwort an.'
              : 'Wir schicken dir einen einmaligen Anmeldelink per E-Mail.'}
          </p>

          <form onSubmit={submit}>
            <label htmlFor="admin-email">E-Mail</label>
            <input
              id="admin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@swiss-sv.ch"
              autoComplete="email"
              required
              disabled={busy}
            />

            {mode === 'password' && (
              <>
                <label htmlFor="admin-password">Passwort</label>
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={busy}
                />
              </>
            )}

            {error && <p className="auth-error">{error}</p>}
            {note && <p className="auth-note">{note}</p>}

            <button
              type="submit"
              className="btn btn-accent"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={busy}
            >
              {busy
                ? 'Einen Moment…'
                : mode === 'password'
                  ? 'Anmelden'
                  : 'Anmeldelink senden'}
            </button>
          </form>

          <p style={{ textAlign: 'center', margin: '14px 0 0' }}>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setMode(mode === 'password' ? 'magic' : 'password');
                setError('');
                setNote('');
              }}
            >
              {mode === 'password'
                ? 'Stattdessen Anmeldelink per E-Mail'
                : 'Stattdessen mit Passwort anmelden'}
            </button>
          </p>
        </div>
      </div>

      <p className="auth-alt">
        Lieferant? <Link href="/">Hier anmelden</Link>
      </p>
    </div>
  );
}
