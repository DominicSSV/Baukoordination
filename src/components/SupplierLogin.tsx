'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { post } from '@/lib/client/api';
import { zielNachAnmeldung } from '@/lib/client/ziel';

/**
 * Startbildschirm der App. Wer den Link zum ersten Mal öffnet, landet direkt hier
 * auf der Anmeldung – nicht auf einer allgemeinen Startseite. Der Weg zum
 * Admin-Login ist bewusst klein und unauffällig (/admin).
 *
 * Es gibt genau einen Weg hinein: E-Mail und Passwort. Der frühere Zugangscode
 * ist abgeschafft. Er war ein zweites Geheimnis, das niemand aufbewahren konnte,
 * und vor allem: Ein einzelnes Codefeld erkennt keine Passwortverwaltung als
 * Anmeldung. Auf der Baustelle hiess das, den Code jedes Mal aus einer alten
 * Mail zu suchen. Mit E-Mail und Passwort bietet das Handy an, die Anmeldung zu
 * speichern – danach ist es ein Fingerabdruck.
 *
 * Die Passwörter vergibt die Swiss Solar Ventures AG. Wer keines hat, bekommt
 * eines von uns; selbst setzen kann es niemand.
 */
export default function SupplierLogin() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [passwort, setPasswort] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminLink] = useState(() => {
    const ziel = zielNachAnmeldung();
    return ziel === '/app' ? '/admin' : `/admin?next=${encodeURIComponent(ziel)}`;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    if (!email.trim() || !passwort) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await post('/api/supplier/login', { email: email.trim(), passwort });
      router.replace(zielNachAnmeldung());
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
            Melde dich mit deiner E-Mail-Adresse und dem Passwort an, das du von
            der Swiss Solar Ventures AG bekommen hast. Du siehst danach nur die
            Projekte, für die du freigegeben bist.
          </p>

          <form onSubmit={submit}>
            {/* autoComplete username/current-password ist hier keine Formalität:
                Erst diese Kombination erkennen Handy und Browser als Anmeldung
                und bieten das Speichern an. */}
            <label htmlFor="login-email">E-Mail</label>
            <input
              id="login-email"
              type="email"
              name="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@firma.ch"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              disabled={busy}
            />

            <label htmlFor="login-passwort">Passwort</label>
            <input
              id="login-passwort"
              type="password"
              name="password"
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              autoComplete="current-password"
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

            <p className="auth-hinweis">
              Kein Passwort oder vergessen? Melde dich bei der Swiss Solar
              Ventures AG, wir geben dir eines.
            </p>
          </form>
        </div>
      </div>

      <p className="auth-alt">
        {/* Das Ziel eines geteilten Links geht auch beim Wechsel zur
            Admin-Anmeldung nicht verloren. */}
        Bauherrenvertreter? <Link href={adminLink}>Hier anmelden</Link>
      </p>
    </div>
  );
}
