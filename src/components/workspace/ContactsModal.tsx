'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, patch, post } from '@/lib/client/api';
import { removeAvatar, uploadAvatar } from '@/lib/client/avatarUpload';
import Avatar from '@/components/Avatar';
import Spinner from '@/components/Spinner';
import WhatsAppButton from '@/components/workspace/WhatsAppButton';
import { waNummer } from '@/lib/whatsapp';
import type { Kontakt } from '@/types';

type Entwurf = {
  name: string;
  firma: string;
  rolle: string;
  kontakt: string;
  email: string;
  mailAn: boolean;
};

/**
 * Register "Kontakte": die ganze Projektmannschaft an einer Stelle – wir und
 * alle Lieferanten, mit Bild, Telefon, Zugangscode und der Angabe, wer auf
 * welches Projekt zugreifen darf.
 *
 * Nur für die Swiss Solar Ventures AG. Hier stehen die Zugangscodes und die
 * Kontaktdaten sämtlicher Firmen beieinander; die Route verlangt deshalb
 * ebenfalls Adminrechte und verlässt sich nicht darauf, dass dieser Dialog
 * gar nicht erst geöffnet wird.
 */
export default function ContactsModal({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { toast, reportError } = useFeedback();
  const [kontakte, setKontakte] = useState<Kontakt[] | null>(null);
  const [projekte, setProjekte] = useState<Array<{ id: string; name: string }>>([]);
  const [ohneTelefonspalte, setOhneTelefonspalte] = useState(false);
  const [ohneMailFreigabe, setOhneMailFreigabe] = useState(false);
  const [ohneZuteilung, setOhneZuteilung] = useState(false);
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const [busy, setBusy] = useState(false);
  const [suche, setSuche] = useState('');
  const bildWahl = useRef<Record<string, HTMLInputElement | null>>({});

  const laden = useCallback(async () => {
    try {
      const res = await api<{
        kontakte: Kontakt[];
        projekte: Array<{ id: string; name: string }>;
        ohneTelefonspalte?: boolean;
        ohneZuteilung?: boolean;
        ohneMailFreigabe?: boolean;
      }>('/api/contacts');
      setKontakte(res.kontakte);
      setProjekte(res.projekte ?? []);
      setOhneTelefonspalte(Boolean(res.ohneTelefonspalte));
      setOhneMailFreigabe(Boolean(res.ohneMailFreigabe));
      setOhneZuteilung(Boolean(res.ohneZuteilung));
    } catch (error) {
      reportError(error, 'Die Kontakte konnten nicht geladen werden.');
      onClose();
    }
  }, [reportError, onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  function bearbeiten(k: Kontakt) {
    setBearbeitet(k.id);
    setEntwurf({
      name: k.name,
      firma: k.firma,
      rolle: k.rolle ?? '',
      kontakt: k.kontakt ?? '',
      email: k.email ?? '',
      mailAn: k.mailAn,
    });
  }

  async function speichern(k: Kontakt) {
    if (!entwurf || busy) return;
    if (!entwurf.name.trim() && !entwurf.firma.trim()) {
      reportError(
        new Error('Bitte mindestens Name oder Firma angeben.'),
        'Nicht gespeichert.',
      );
      return;
    }

    setBusy(true);
    try {
      if (k.art === 'admin') {
        await patch('/api/contacts', {
          userId: k.id,
          name: entwurf.name.trim(),
          firma: entwurf.firma.trim(),
          funktion: entwurf.rolle.trim() || null,
          kontakt: entwurf.kontakt.trim() || null,
        });
      } else {
        await patch(`/api/suppliers/${k.id}`, {
          name: entwurf.name.trim(),
          firma: entwurf.firma.trim(),
          gewerk: entwurf.rolle.trim(),
          kontakt: entwurf.kontakt.trim(),
          email: entwurf.email.trim(),
          mailAn: entwurf.mailAn,
        });
      }
      setBearbeitet(null);
      setEntwurf(null);
      await laden();
      await onChanged();
      toast('✓ Gespeichert.');
    } catch (error) {
      reportError(error, 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Zugriff auf ein Projekt erteilen oder entziehen.
   *
   * Geht über dieselbe Route wie im Projekt selbst – dort hängt am Entzug auch
   * das Beenden noch offener Sitzungen, das darf hier nicht fehlen.
   */
  async function zugriffUmschalten(k: Kontakt, projektId: string) {
    const hat = k.projekte.includes(projektId);
    setBusy(true);
    try {
      await post(`/api/projects/${projektId}/access`, {
        ...(k.art === 'admin' ? { userId: k.id } : { supplierId: k.id }),
        grant: !hat,
      });
      await laden();
      await onChanged();
    } catch (error) {
      reportError(error, 'Zugriff konnte nicht geändert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function bildSetzen(k: Kontakt, datei: File | null) {
    if (!datei) return;
    setBusy(true);
    try {
      await uploadAvatar(
        datei,
        k.art === 'lieferant' ? k.id : null,
        k.art === 'admin' ? k.id : null,
      );
      await laden();
      await onChanged();
      toast('✓ Bild aktualisiert.');
    } catch (error) {
      reportError(error, 'Bild konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function bildEntfernen(k: Kontakt) {
    setBusy(true);
    try {
      await removeAvatar(
        k.art === 'lieferant' ? k.id : null,
        k.art === 'admin' ? k.id : null,
      );
      await laden();
      await onChanged();
    } catch (error) {
      reportError(error, 'Bild konnte nicht entfernt werden.');
    } finally {
      setBusy(false);
    }
  }

  const projektName = (id: string) =>
    projekte.find((p) => p.id === id)?.name ?? '';

  const begriff = suche.trim().toLowerCase();
  const gefiltert = (kontakte ?? []).filter((k) =>
    begriff
      ? [k.name, k.firma, k.rolle, k.kontakt, k.email, ...k.projekte.map(projektName)]
          .filter(Boolean)
          .some((t) => String(t).toLowerCase().includes(begriff))
      : true,
  );

  const unsere = gefiltert.filter((k) => k.art === 'admin');
  const lieferanten = gefiltert.filter((k) => k.art === 'lieferant');

  function zeile(k: Kontakt) {
    if (bearbeitet === k.id && entwurf) {
      return (
        <div className="kontakt-zeile bearbeitet" key={k.id}>
          <div className="kontakt-form">
            <input
              type="text"
              value={entwurf.name}
              placeholder="Name"
              onChange={(e) => setEntwurf({ ...entwurf, name: e.target.value })}
            />
            <input
              type="text"
              value={entwurf.firma}
              placeholder="Firma"
              onChange={(e) => setEntwurf({ ...entwurf, firma: e.target.value })}
            />
            <input
              type="text"
              value={entwurf.rolle}
              placeholder={k.art === 'admin' ? 'Funktion' : 'Gewerk'}
              onChange={(e) => setEntwurf({ ...entwurf, rolle: e.target.value })}
            />
            <input
              type="text"
              value={entwurf.kontakt}
              placeholder="Telefon"
              onChange={(e) => setEntwurf({ ...entwurf, kontakt: e.target.value })}
            />
            {k.art === 'lieferant' ? (
              <input
                type="email"
                value={entwurf.email}
                placeholder="E-Mail"
                onChange={(e) => setEntwurf({ ...entwurf, email: e.target.value })}
              />
            ) : (
              // An der E-Mail hängt die Anmeldung – sie hier zu ändern würde
              // jemanden aussperren.
              <span className="kontakt-fest" title="Anmeldeadresse, hier nicht änderbar">
                {k.email ?? '—'}
              </span>
            )}
          </div>

          {/* Lieferanten bekommen nur Post, wenn es hier ausdrücklich
              eingeschaltet ist. Bei uns entscheidet die Firmen-Domain – dort
              gibt es nichts zu wählen. */}
          {k.art === 'lieferant' && (
            <label className="kontakt-mail-an">
              <input
                type="checkbox"
                checked={entwurf.mailAn}
                disabled={ohneMailFreigabe}
                onChange={(e) => setEntwurf({ ...entwurf, mailAn: e.target.checked })}
              />
              <span>
                Bekommt Benachrichtigungen per Mail
                {!entwurf.email.trim() && (
                  <span className="kontakt-ohne"> – dafür fehlt noch die Adresse</span>
                )}
                {ohneMailFreigabe && (
                  <span className="kontakt-ohne">
                    {' '}
                    – möglich ab der Datenbank-Aktualisierung 0027
                  </span>
                )}
              </span>
            </label>
          )}

          <div className="kontakt-knoepfe">
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => void speichern(k)}
              disabled={busy}
            >
              Speichern
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setBearbeitet(null);
                setEntwurf(null);
              }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="kontakt-zeile" key={k.id}>
        <button
          type="button"
          className="kontakt-bild"
          title="Bild wechseln"
          onClick={() => bildWahl.current[k.id]?.click()}
          disabled={busy}
        >
          <Avatar url={k.avatarUrl} name={k.name || k.firma} size={40} />
        </button>
        <input
          ref={(el) => {
            bildWahl.current[k.id] = el;
          }}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            void bildSetzen(k, e.target.files?.[0] ?? null);
            e.target.value = '';
          }}
        />

        <div className="kontakt-text">
          <div className="kontakt-name">
            {k.name || k.firma}
            {k.name && k.firma && <span className="kontakt-firma"> ({k.firma})</span>}
          </div>
          <div className="kontakt-meta">
            {[k.rolle, k.kontakt, k.email].filter(Boolean).join(' · ') || '—'}
          </div>
          {k.art === 'lieferant' && (
            <div className="kontakt-meta">
              Code: <strong>{k.code ?? '—'}</strong>
              {!k.projekte.length && (
                <span className="kontakt-ohne"> · kein Projekt freigegeben</span>
              )}
              {/* Auf einen Blick erkennbar, wer von aussen Post bekommt – die
                  Liste ist lang, und Nachschauen je Person wäre mühsam. */}
              {k.mailAn ? (
                <span className="kontakt-mail-marke">📧 Mail an</span>
              ) : (
                <span className="kontakt-ohne"> · keine Mails</span>
              )}
            </div>
          )}

          {/* Beim Lieferanten steuern die Merkzeichen den Zugriff, bei uns nur,
              wer Post bekommt – gesehen wird intern überall alles. */}
          {(k.art === 'lieferant' || !ohneZuteilung) && (
            <>
              {k.art === 'admin' && (
                <div className="kontakt-meta">
                  Benachrichtigungen:{' '}
                  {k.projekte.length ? (
                    `${k.projekte.length} Projekt${k.projekte.length === 1 ? '' : 'e'}`
                  ) : (
                    <span className="kontakt-alle">alle Projekte</span>
                  )}
                </div>
              )}
              <div className="kontakt-projekte">
                {projekte.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`kontakt-projekt ${
                      k.projekte.includes(p.id) ? 'frei' : ''
                    }`}
                    title={
                      k.art === 'admin'
                        ? k.projekte.includes(p.id)
                          ? `Keine Benachrichtigungen mehr für ${p.name}`
                          : `Benachrichtigungen für ${p.name} erhalten`
                        : k.projekte.includes(p.id)
                          ? `Zugriff auf ${p.name} entziehen`
                          : `Zugriff auf ${p.name} erteilen`
                    }
                    onClick={() => void zugriffUmschalten(k, p.id)}
                    disabled={busy}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="kontakt-knoepfe">
          {waNummer(k.kontakt) && (
            <WhatsAppButton
              klasse="icon-btn"
              beschriftung=""
              nummer={waNummer(k.kontakt)}
              titel={`Nachricht an ${k.name || k.firma}`}
              text={`Ciao ${(k.name || k.firma).split(' ')[0]}`}
            />
          )}
          <button
            type="button"
            className="icon-btn"
            title="Bearbeiten"
            onClick={() => bearbeiten(k)}
          >
            ✏️
          </button>
          {k.avatarUrl && (
            <button
              type="button"
              className="icon-btn"
              title="Bild entfernen"
              onClick={() => void bildEntfernen(k)}
              disabled={busy}
            >
              ✕
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal kontakt-modal">
        <div className="kontakt-kopf">
          <h3 style={{ fontSize: 19, margin: 0 }}>Kontakte</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {!kontakte ? (
          <Spinner size={36} label="Lade Kontakte…" />
        ) : (
          <>
            <input
              type="text"
              className="kontakt-suche"
              value={suche}
              placeholder="Suchen – Name, Firma, Gewerk, Projekt…"
              onChange={(e) => setSuche(e.target.value)}
            />

            {ohneTelefonspalte && (
              <p className="speicher-hinweis">
                Telefonnummern bei uns gibt es erst nach der Datenbank-Aktualisierung
                0023. Bis dahin lassen sich nur Name, Firma und Funktion ändern.
              </p>
            )}

            <div className="kontakt-gruppe-titel">Swiss Solar Ventures AG</div>
            <p className="kontakt-erklaerung">
              Die Merkzeichen steuern nur, wer für welches Projekt Post bekommt.
              Sehen tun wir überall alles. Ist niemand zugeteilt, gehen die
              Nachrichten an alle.
            </p>
            {unsere.length ? (
              unsere.map(zeile)
            ) : (
              <p className="kontakt-leer">Niemand gefunden.</p>
            )}

            <div className="kontakt-gruppe-titel">
              Lieferanten <span className="gruppe-anzahl">{lieferanten.length}</span>
            </div>
            {lieferanten.length ? (
              lieferanten.map(zeile)
            ) : (
              <p className="kontakt-leer">Niemand gefunden.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
