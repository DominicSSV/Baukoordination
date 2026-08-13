'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { post } from '@/lib/client/api';
import { zielNachAnmeldung } from '@/lib/client/ziel';

/**
 * Kleiner Spass: 6340 ist die Postleitzahl von Baar, kein Zugangscode. Wer es
 * trotzdem versucht, bekommt eine Antwort statt einer Fehlermeldung – bei jedem
 * Versuch eine andere.
 */
const SCHERZ_CODE = '6340';

const SPRUECHE = [
  'So einfach geht das nun also wirklich nicht 😄',
  'Netter Versuch. Das ist die Postleitzahl von unserem Sitz in Baar, nicht der Zugangscode.',
  'Immer noch nein. Aber Ausdauer hast du, das muss man dir lassen.',
  'Auch beim vierten Mal öffnet sich hier nichts. Ehrlich.',
  'Okay, du gewinnst – aber nur an Hartnäckigkeit. Frag Dominic nach dem Code.',
];

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
  const [scherz, setScherz] = useState('');
  const [versuche, setVersuche] = useState(0);
  const [adminLink] = useState(() => {
    const ziel = zielNachAnmeldung();
    return ziel === '/app' ? '/admin' : `/admin?next=${encodeURIComponent(ziel)}`;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const value = code.trim();
    if (!value) {
      setError('Bitte gib deinen Zugangscode ein.');
      return;
    }

    if (value === SCHERZ_CODE) {
      setError('');
      setScherz(SPRUECHE[Math.min(versuche, SPRUECHE.length - 1)]);
      setVersuche((n) => n + 1);
      setCode('');
      return;
    }

    setBusy(true);
    setError('');
    setScherz('');
    try {
      await post('/api/supplier/login', { code: value });
      router.replace(zielNachAnmeldung());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Anmeldung fehlgeschlagen.');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className={`auth-card ${scherz ? 'wackelt' : ''}`}>
        <div className="stripe-bar" />
        <div className="auth-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-logo" src="/logo.png" alt="Swiss Solar Ventures AG" />
          <div className="eyebrow">Baukoordination</div>
          <h1>Als Lieferant anmelden</h1>
          <p>
            Gib den Zugangscode ein, den du per E-Mail von der Swiss Solar Ventures AG
            erhalten hast. Du siehst danach nur die Projekte, für die du freigegeben bist.
          </p>

          <form onSubmit={submit}>
            <label htmlFor="login-code">Zugangscode</label>
            <input
              id="login-code"
              className="code-input"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setScherz('');
              }}
              placeholder="z.B. A7K2M9"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              autoFocus
              maxLength={12}
              disabled={busy}
            />

            {error && <p className="auth-error">{error}</p>}
            {scherz && <p className="auth-scherz">{scherz}</p>}

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
        {/* Das Ziel eines geteilten Links geht auch beim Wechsel zur
            Admin-Anmeldung nicht verloren. */}
        Bauherrenvertreter? <Link href={adminLink}>Hier anmelden</Link>
      </p>
    </div>
  );
}
