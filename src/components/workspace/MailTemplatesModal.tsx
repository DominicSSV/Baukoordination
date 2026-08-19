'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch } from '@/lib/client/api';
import Spinner from '@/components/Spinner';

type Vorlage = {
  schluessel: string;
  name: string;
  beschreibung: string;
  betreff: string;
  text: string;
  standardBetreff: string;
  standardText: string;
  angepasst: boolean;
  geaendertAm: string | null;
  geaendertVon: string | null;
  platzhalter: Array<{ name: string; erklaerung: string }>;
};

/**
 * Die Texte der verschickten Mails ändern.
 *
 * Nur für die Swiss Solar Ventures AG – hier steht, was in unserem Namen
 * hinausgeht. Bearbeitet wird reiner Text; die Gestaltung (Logo, Rahmen,
 * Farben) hängt die App an. So kann eine Formulierung das Aussehen der Mail
 * nicht durcheinanderbringen.
 */
export default function MailTemplatesModal({ onClose }: { onClose: () => void }) {
  const { toast, reportError, confirm } = useFeedback();
  const [vorlagen, setVorlagen] = useState<Vorlage[] | null>(null);
  const [ohneTabelle, setOhneTabelle] = useState(false);
  const [offen, setOffen] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<{ betreff: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const laden = useCallback(async () => {
    try {
      const res = await api<{ vorlagen: Vorlage[]; ohneTabelle?: boolean }>(
        '/api/mail-templates',
      );
      setVorlagen(res.vorlagen);
      setOhneTabelle(Boolean(res.ohneTabelle));
    } catch (error) {
      reportError(error, 'Die Texte konnten nicht geladen werden.');
      onClose();
    }
  }, [reportError, onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  function oeffnen(v: Vorlage) {
    setOffen(v.schluessel);
    setEntwurf({ betreff: v.betreff, text: v.text });
  }

  async function speichern(v: Vorlage) {
    if (!entwurf || busy) return;
    if (!entwurf.betreff.trim() || !entwurf.text.trim()) {
      reportError(
        new Error('Betreff und Text dürfen nicht leer sein.'),
        'Nicht gespeichert.',
      );
      return;
    }

    setBusy(true);
    try {
      await patch('/api/mail-templates', {
        schluessel: v.schluessel,
        betreff: entwurf.betreff.trim(),
        text: entwurf.text.trim(),
      });
      setOffen(null);
      setEntwurf(null);
      await laden();
      toast('✓ Text gespeichert.');
    } catch (error) {
      reportError(error, 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  }

  function zuruecksetzen(v: Vorlage) {
    confirm(`„${v.name}“ auf den ursprünglichen Text zurücksetzen?`, async () => {
      await del('/api/mail-templates', { schluessel: v.schluessel });
      setOffen(null);
      setEntwurf(null);
      await laden();
      toast('↩️ Ursprünglicher Text wiederhergestellt.');
    });
  }

  /** Platzhalter an der Schreibmarke einfügen – tippen muss man ihn nicht. */
  function platzhalterEinfuegen(name: string) {
    setEntwurf((e) => (e ? { ...e, text: `${e.text}${name}` } : e));
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal vorlagen-modal">
        <div className="kontakt-kopf">
          <h3 style={{ fontSize: 19, margin: 0 }}>Nachrichten</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="kontakt-erklaerung" style={{ marginTop: 0 }}>
          Die Texte der Mails, die die App verschickt. Bearbeitet wird reiner Text –
          Logo, Rahmen und Farben hängt die App selbst an. Wörter in geschweiften
          Klammern werden beim Versenden ersetzt.
        </p>

        {ohneTabelle && (
          <p className="speicher-hinweis">
            Änderungen lassen sich erst nach der Datenbank-Aktualisierung 0025
            speichern. Bis dahin siehst du hier die aktuell verwendeten Texte.
          </p>
        )}

        {!vorlagen ? (
          <Spinner size={36} label="Lade Texte…" />
        ) : (
          vorlagen.map((v) => {
            const bearbeitet = offen === v.schluessel;

            return (
              <div className="vorlage" key={v.schluessel}>
                <div className="vorlage-kopf">
                  <div>
                    <div className="vorlage-name">
                      {v.name}
                      {v.angepasst && <span className="vorlage-marke">angepasst</span>}
                    </div>
                    <div className="vorlage-zweck">{v.beschreibung}</div>
                  </div>
                  <div className="kontakt-knoepfe">
                    {v.angepasst && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => zuruecksetzen(v)}
                      >
                        Zurücksetzen
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => (bearbeitet ? setOffen(null) : oeffnen(v))}
                    >
                      {bearbeitet ? 'Schliessen' : '✏️ Bearbeiten'}
                    </button>
                  </div>
                </div>

                {!bearbeitet ? (
                  <div className="vorlage-vorschau">
                    <strong>{v.betreff}</strong>
                    <pre>{v.text}</pre>
                  </div>
                ) : (
                  entwurf && (
                    <div className="vorlage-form">
                      <label htmlFor={`betreff-${v.schluessel}`}>Betreff</label>
                      <input
                        id={`betreff-${v.schluessel}`}
                        type="text"
                        value={entwurf.betreff}
                        maxLength={200}
                        onChange={(e) =>
                          setEntwurf({ ...entwurf, betreff: e.target.value })
                        }
                      />

                      <label htmlFor={`text-${v.schluessel}`}>Text</label>
                      <textarea
                        id={`text-${v.schluessel}`}
                        value={entwurf.text}
                        rows={12}
                        maxLength={8000}
                        onChange={(e) => setEntwurf({ ...entwurf, text: e.target.value })}
                      />

                      <div className="vorlage-platzhalter">
                        {v.platzhalter.map((p) => (
                          <button
                            key={p.name}
                            type="button"
                            className="kontakt-projekt"
                            title={`${p.erklaerung} – anklicken zum Anhängen`}
                            onClick={() => platzhalterEinfuegen(p.name)}
                          >
                            {p.name}
                          </button>
                        ))}
                      </div>

                      <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setOffen(null);
                            setEntwurf(null);
                          }}
                        >
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          className="btn btn-accent btn-sm"
                          onClick={() => void speichern(v)}
                          disabled={busy}
                        >
                          Speichern
                        </button>
                      </div>

                      {v.geaendertAm && (
                        <div className="vorlage-zweck">
                          Zuletzt geändert von {v.geaendertVon ?? 'unbekannt'} am{' '}
                          {new Date(v.geaendertAm).toLocaleDateString('de-CH')}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
