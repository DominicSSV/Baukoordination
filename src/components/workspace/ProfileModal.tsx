'use client';

import { useRef, useState } from 'react';
import Avatar from '@/components/Avatar';
import { useFeedback } from '@/components/Feedback';
import { post } from '@/lib/client/api';
import { setzeTon, spieleMuenze, tonAn } from '@/lib/client/ton';
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
  // Lazy gelesen: Auf dem Server gibt es den Browserspeicher nicht.
  const [ton, setTon] = useState(() => tonAn());
  const input = useRef<HTMLInputElement>(null);


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

        {/* Der Ton hängt am Gerät, nicht am Konto: Im Büro will man ihn
            vielleicht, in der Sitzung nicht. */}
        <label className="ton-schalter">
          <input
            type="checkbox"
            checked={ton}
            onChange={(e) => {
              const an = e.target.checked;
              setTon(an);
              setzeTon(an);
              if (an) spieleMuenze();
            }}
          />
          <span>
            Ton beim Abhaken einer Aufgabe
            <span className="vorlage-zweck">
              Gilt nur auf diesem Gerät. Beim Einschalten hörst du ihn gleich.
            </span>
          </span>
        </label>

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
              <strong>Anmeldung</strong>
              <span className={session.hatPasswort ? 'mail-an' : 'mail-aus'}>
                {session.hatPasswort ? 'mit Passwort' : 'nur mit Zugangscode'}
              </span>
            </div>
            <p>
              {session.hatPasswort
                ? `Du meldest dich mit ${session.email ?? 'deiner E-Mail-Adresse'} und dem Passwort an, das du von der Swiss Solar Ventures AG bekommen hast.`
                : 'Für dich ist noch kein Passwort hinterlegt. Melde dich bei der Swiss Solar Ventures AG – sie vergibt es.'}
            </p>
            <p>
              Passwörter vergibt die Swiss Solar Ventures AG. Brauchst du ein
              neues, melde dich bei deiner Ansprechperson.
            </p>
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
