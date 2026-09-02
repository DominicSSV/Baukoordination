'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch, post } from '@/lib/client/api';
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
  /** Die gerenderte Mail zum aktuellen Entwurf – null, solange sie fehlt. */
  const [vorschau, setVorschau] = useState<{ betreff: string; html: string } | null>(
    null,
  );

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
    setVorschau(null);
  }

  function schliessen() {
    setOffen(null);
    setEntwurf(null);
    setVorschau(null);
  }

  /**
   * Die Vorschau wird auf dem Server gebaut – mit demselben Rahmen, in den auch
   * die echte Post gelegt wird. Nachgezogen wird erst, wenn eine halbe Sekunde
   * nichts mehr getippt wurde: Bei jedem Buchstaben eine Anfrage zu stellen
   * wäre Verschwendung, und das Bild würde flackern.
   */
  useEffect(() => {
    if (!offen) return;

    const t = window.setTimeout(() => {
      // Ohne Betreff oder Text gibt es nichts zu zeigen; die alte Vorschau
      // stehen zu lassen wäre irreführend.
      if (!entwurf?.betreff.trim() || !entwurf.text.trim()) {
        setVorschau(null);
        return;
      }

      void post<{ betreff: string; html: string }>('/api/mail-templates/vorschau', {
        schluessel: offen,
        betreff: entwurf.betreff,
        text: entwurf.text,
      })
        .then(setVorschau)
        .catch(() => {
          // Eine fehlende Vorschau ist kein Grund für eine Fehlermeldung – der
          // Text lässt sich weiterhin bearbeiten und speichern.
        });
    }, 500);

    return () => window.clearTimeout(t);
  }, [offen, entwurf]);

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
      schliessen();
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
      schliessen();
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

            /**
             * Eine angepasste Einladung von vor der Umstellung auf Passwörter.
             *
             * {code} wird nicht mehr gefüllt – in der Mail stünde wörtlich
             * "{code}". Die App schickt deshalb wieder den Standardtext. Das
             * muss hier stehen, sonst ändert man den Text und wundert sich,
             * warum die Mail anders aussieht.
             */
            const veraltet =
              v.schluessel === 'einladung' && v.angepasst && v.text.includes('{code}');

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
                      onClick={() => (bearbeitet ? schliessen() : oeffnen(v))}
                    >
                      {bearbeitet ? 'Schliessen' : '✏️ Bearbeiten'}
                    </button>
                  </div>
                </div>

                {veraltet && (
                  <p className="speicher-hinweis">
                    Dieser angepasste Text nennt noch den Zugangscode ({'{code}'}) – den
                    gibt es nicht mehr, die Anmeldung läuft über E-Mail und Passwort.
                    Solange er hier steht, verschickt die App den Standardtext. Nimm
                    {' {code}'} heraus und setze stattdessen {'{email}'} und{' '}
                    {'{passwort}'} ein, oder drücke auf „Zurücksetzen“.
                  </p>
                )}

                {!bearbeitet ? (
                  <div className="vorlage-vorschau">
                    <div className="vorlage-marke-klein">Vorlage mit Platzhaltern</div>
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

                      {/* Der Grund für diese Vorschau: Im Feld darüber steht
                          nackter Text mit Platzhaltern, angekommen ist bisher
                          etwas ganz anderes. Hier steht die fertige Mail. */}
                      <div className="vorlage-mail">
                        <div className="vorlage-mail-kopf">
                          So kommt die Mail an
                          {vorschau && (
                            <span className="vorlage-mail-betreff">
                              Betreff: {vorschau.betreff}
                            </span>
                          )}
                        </div>
                        {vorschau ? (
                          <iframe
                            className="vorlage-mail-rahmen"
                            srcDoc={vorschau.html}
                            sandbox=""
                            title="Vorschau der Mail"
                          />
                        ) : (
                          <p className="vorlage-zweck" style={{ padding: 12 }}>
                            Vorschau wird erstellt…
                          </p>
                        )}
                        <p className="vorlage-zweck" style={{ padding: '0 12px 10px' }}>
                          Mit Beispielangaben gefüllt. Beim Versand stehen dort die
                          echten Namen, Projekte und Termine.
                        </p>
                      </div>

                      <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={schliessen}
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
