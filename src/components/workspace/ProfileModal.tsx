'use client';

import { useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import { useFeedback } from '@/components/Feedback';
import { post } from '@/lib/client/api';
import { removeAvatar, uploadAvatar } from '@/lib/client/avatarUpload';
import type { SessionInfo } from '@/types';

/** Eigenes Profil: zeigt, wer angemeldet ist, und lässt das Bild wechseln. */
export default function ProfileModal({
  session,
  avatarUrl,
  onAvatarChange,
  onClose,
}: {
  session: SessionInfo;
  avatarUrl: string | null;
  onAvatarChange: (url: string | null) => void;
  onClose: () => void;
}) {
  const { toast, reportError } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailZiel, setMailZiel] = useState(
    session.kind === 'admin' ? (session.email ?? '') : '',
  );
  const [passwort, setPasswort] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [passwortBusy, setPasswortBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  /**
   * Passwort setzen – nur für Lieferanten.
   *
   * Bei uns läuft die Anmeldung über den Anmeldedienst, dort gibt es hier
   * nichts einzustellen. Bei den Lieferanten ist es der Ersatz für den
   * Zugangscode, den keine Passwortverwaltung speichert.
   */
  async function passwortSetzen() {
    if (passwort !== wiederholung) {
      reportError(
        new Error('Die beiden Eingaben stimmen nicht überein.'),
        'Nicht gespeichert.',
      );
      return;
    }

    setPasswortBusy(true);
    try {
      await post('/api/supplier/passwort', { passwort });
      setPasswort('');
      setWiederholung('');
      toast('✓ Passwort gesetzt. Ab jetzt geht die Anmeldung mit E-Mail und Passwort.');
    } catch (error) {
      reportError(error, 'Passwort konnte nicht gesetzt werden.');
    } finally {
      setPasswortBusy(false);
    }
  }

  /** Prüft in einem Schritt Schlüssel, Absenderadresse und Zustellung. */
  async function testmail() {
    setMailBusy(true);
    try {
      const { an } = await post<{ an: string }>('/api/mail/test', {
        an: mailZiel.trim() || undefined,
      });
      toast(`✉️ Testmail an ${an} verschickt.`);
    } catch (error) {
      reportError(error, 'Testmail konnte nicht verschickt werden.');
    } finally {
      setMailBusy(false);
    }
  }

  async function waehlen(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadAvatar(file);
      onAvatarChange(url);
      toast('✓ Profilbild gespeichert.');
    } catch (error) {
      reportError(error, 'Profilbild konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function entfernen() {
    setBusy(true);
    try {
      await removeAvatar();
      onAvatarChange(null);
      toast('Profilbild entfernt.');
    } catch (error) {
      reportError(error, 'Profilbild konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 420 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 14,
          }}
        >
          <h3 style={{ fontSize: 19 }}>Mein Profil</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="avatar-edit">
          <Avatar url={avatarUrl} name={session.name} size={72} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{session.name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              {session.kind === 'admin'
                ? session.firma
                : [session.firma, 'Lieferant'].filter(Boolean).join(' · ')}
            </div>
            {session.kind === 'admin' && session.email && (
              <div style={{ fontSize: 12, color: 'var(--ink-faint)' }}>{session.email}</div>
            )}
          </div>
        </div>

        <p style={{ fontSize: 12.5 }}>
          Das Bild wird auf ein Quadrat zugeschnitten und verkleinert. Es erscheint
          überall dort, wo dein Name steht.
        </p>

        <input
          ref={input}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            void waehlen(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        {session.kind === 'supplier' && (
          <div className="mail-status">
            <div className="mail-status-kopf">
              <strong>Passwort für die Anmeldung</strong>
              <span className={session.hatPasswort ? 'mail-an' : 'mail-aus'}>
                {session.hatPasswort ? 'gesetzt' : 'noch keines'}
              </span>
            </div>
            <p>
              {session.hatPasswort
                ? 'Du meldest dich mit deiner E-Mail-Adresse und deinem Passwort an. '
                  + 'Hier kannst du ein neues setzen; dein Zugangscode bleibt daneben '
                  + 'gültig, falls du es einmal vergisst.'
                : 'Mit einem Passwort meldest du dich künftig mit deiner '
                  + 'E-Mail-Adresse an – dein Handy bietet dann an, die Anmeldung zu '
                  + 'speichern. Dein Zugangscode bleibt daneben gültig, falls du das '
                  + 'Passwort einmal vergisst.'}
            </p>
            {!session.email && (
              <p className="kontakt-ohne">
                Dafür fehlt noch deine E-Mail-Adresse – bitte melde dich bei der
                Swiss Solar Ventures AG.
              </p>
            )}

            {/* Versteckt, aber vorhanden: Ohne ein Feld für den Benutzernamen
                weiss die Passwortverwaltung nicht, wozu das Passwort gehört. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={session.email ?? ''}
              readOnly
              hidden
            />

            <div className="passwort-felder">
              <input
                type="password"
                value={passwort}
                onChange={(e) => setPasswort(e.target.value)}
                placeholder="Neues Passwort (mind. 8 Zeichen)"
                aria-label="Neues Passwort"
                autoComplete="new-password"
              />
              <input
                type="password"
                value={wiederholung}
                onChange={(e) => setWiederholung(e.target.value)}
                placeholder="Nochmals eingeben"
                aria-label="Passwort wiederholen"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={passwortSetzen}
                disabled={
                  passwortBusy ||
                  passwort.length < 8 ||
                  !wiederholung ||
                  !session.email
                }
              >
                {passwortBusy ? 'Einen Moment…' : 'Speichern'}
              </button>
            </div>
          </div>
        )}

        {session.kind === 'admin' && (
          <div className="mail-status">
            <div className="mail-status-kopf">
              <strong>Automatischer Mailversand</strong>
              <span className={session.mailEnabled ? 'mail-an' : 'mail-aus'}>
                {session.mailEnabled ? 'eingerichtet' : 'nicht eingerichtet'}
              </span>
            </div>
            <p>
              {session.mailEnabled
                ? 'Bei jeder Aktivität geht eine Nachricht an uns. Prüfe die Zustellung mit einer Testmail an dich selbst.'
                : 'In Vercel fehlt die Umgebungsvariable RESEND_API_KEY. Solange sie fehlt, wird nichts verschickt – die App funktioniert sonst normal.'}
            </p>
            {session.mailEnabled && (
              <p>
                {session.mailAnLieferanten
                  ? 'Lieferanten erhalten ebenfalls Benachrichtigungen.'
                  : 'Lieferanten erhalten keine automatischen Mails – nur die Einladung mit dem Zugangscode, die du von Hand auslöst.'}
                {' '}Für welche Projekte du selbst Post bekommst, stellst du unter
                Kontakte ein.
              </p>
            )}
            <div className="mail-test">
              <input
                type="email"
                value={mailZiel}
                onChange={(e) => setMailZiel(e.target.value)}
                placeholder="Empfänger der Testmail"
                aria-label="Empfänger der Testmail"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={testmail}
                disabled={mailBusy || !mailZiel.trim()}
              >
                {mailBusy ? 'Wird verschickt…' : '✉️ Testmail'}
              </button>
            </div>
          </div>
        )}

        <div className="form-actions" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-accent"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            {busy ? 'Einen Moment…' : avatarUrl ? '📷 Bild wechseln' : '📷 Bild wählen'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={entfernen}
              disabled={busy}
            >
              Entfernen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
