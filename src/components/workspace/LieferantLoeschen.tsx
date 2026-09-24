'use client';

import { useState } from 'react';
import type { Kontakt } from '@/types';

/**
 * Einen Lieferanten endgültig löschen – in drei Schritten.
 *
 * Warum drei: Das hier ist der folgenreichste Handgriff der ganzen App. Er
 * nimmt einer Firma den Zugang zu SÄMTLICHEN Projekten, macht die
 * Anmeldedaten ungültig und lässt sich nicht rückgängig machen – der
 * Papierkorb hilft nicht, er kennt nur Aufgaben und Dateien.
 *
 * Ein einzelner Bestätigungsdialog wird nach dem zwanzigsten Mal
 * weggeklickt, ohne gelesen zu werden. Deshalb drei Schritte, und jeder
 * fragt etwas anderes:
 *
 *   1. Was verloren geht – zum Lesen.
 *   2. Ob wirklich diese Firma gemeint ist – der häufigste Fehler ist die
 *      falsche Zeile, nicht der falsche Entschluss.
 *   3. Den Namen abtippen. Das kann man nicht aus Versehen.
 *
 * Der dritte Schritt ist der eigentliche Schutz. Die beiden davor sorgen
 * dafür, dass man beim Tippen schon weiss, was man tut.
 */
export default function LieferantLoeschen({
  kontakt,
  projektNamen,
  busy,
  onAbbrechen,
  onLoeschen,
}: {
  kontakt: Kontakt;
  /** Projekte, auf die diese Person Zugriff hat – Namen, nicht Kennungen. */
  projektNamen: string[];
  busy: boolean;
  onAbbrechen: () => void;
  onLoeschen: () => void | Promise<void>;
}) {
  const [schritt, setSchritt] = useState(1);
  const [getippt, setGetippt] = useState('');

  const anzeige = kontakt.name?.trim() || kontakt.firma?.trim() || 'Unbekannt';
  // Abgetippt wird der Name, der auch oben steht – sonst rät man, was gemeint ist.
  const stimmt = getippt.trim().toLowerCase() === anzeige.toLowerCase();

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onAbbrechen();
      }}
    >
      <div className="modal loesch-modal">
        <div className="loesch-kopf">
          <span className="loesch-zeichen" aria-hidden="true">⚠️</span>
          <div>
            <h3>Lieferant endgültig löschen</h3>
            <div className="loesch-schritt">Schritt {schritt} von 3</div>
          </div>
        </div>

        <div className="loesch-name">{anzeige}</div>

        {schritt === 1 && (
          <>
            <p className="loesch-warnung">
              Das lässt sich <strong>nicht rückgängig machen</strong>. Der
              Papierkorb hilft hier nicht – er kennt nur Aufgaben und Dateien.
            </p>
            <ul className="loesch-liste">
              <li>Die Anmeldung wird sofort ungültig – auch offene Sitzungen.</li>
              <li>
                Der Zugriff auf <strong>alle</strong> Projekte geht verloren, nicht
                nur auf eines.
              </li>
              <li>Das vergebene Passwort ist weg und muss neu ausgegeben werden.</li>
              <li>
                Hochgeladene Dateien und geschriebene Kommentare bleiben stehen,
                verlieren aber ihre Zuordnung.
              </li>
            </ul>
            <p className="loesch-hinweis">
              Soll die Firma nur ein Projekt nicht mehr sehen? Dann im Projekt
              unter „Lieferanten“ den Zugriff entziehen – das ist rückgängig zu
              machen, hier nicht.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={onAbbrechen}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn btn-warnung"
                onClick={() => setSchritt(2)}
              >
                Verstanden, weiter
              </button>
            </div>
          </>
        )}

        {schritt === 2 && (
          <>
            <p className="loesch-warnung">Ist wirklich diese Firma gemeint?</p>
            <div className="loesch-karte">
              <div>
                <strong>{anzeige}</strong>
                {kontakt.firma && kontakt.name && <div>{kontakt.firma}</div>}
              </div>
              {kontakt.email && <div>{kontakt.email}</div>}
              {kontakt.rolle && <div>{kontakt.rolle}</div>}
              <div className="loesch-projekte">
                {projektNamen.length
                  ? `Verliert den Zugriff auf: ${projektNamen.join(', ')}`
                  : 'Hat zurzeit auf kein Projekt Zugriff.'}
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSchritt(1)}>
                Zurück
              </button>
              <button
                type="button"
                className="btn btn-warnung"
                onClick={() => setSchritt(3)}
              >
                Ja, diese Firma
              </button>
            </div>
          </>
        )}

        {schritt === 3 && (
          <>
            <p className="loesch-warnung">
              Letzter Schritt: Tipp zur Bestätigung den Namen ab.
            </p>
            <p className="loesch-hinweis">
              Abzutippen: <code>{anzeige}</code>
            </p>
            <input
              type="text"
              value={getippt}
              onChange={(e) => setGetippt(e.target.value)}
              placeholder="Name abtippen"
              aria-label="Name zur Bestätigung"
              autoFocus
            />
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setSchritt(2)}>
                Zurück
              </button>
              <button
                type="button"
                className="btn btn-gefahr"
                disabled={!stimmt || busy}
                onClick={() => void onLoeschen()}
              >
                {busy ? 'Wird gelöscht…' : '🗑️ Endgültig löschen'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
