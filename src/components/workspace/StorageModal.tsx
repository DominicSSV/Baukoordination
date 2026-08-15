'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api } from '@/lib/client/api';
import { fmtSize } from '@/lib/format';
import Spinner from '@/components/Spinner';

type Belegung = {
  gesamt: number;
  /** true = Zahl von Supabase selbst, sonst von der App zusammengezählt. */
  ausSupabase: boolean;
  /** Grösse der Datenbank – eigenes Kontingent, null ohne Migration 0018. */
  datenbank: number | null;
  papierkorb: number;
  /** Anteil der automatisch erzeugten Vorschaubilder. */
  vorschau: number;
  /** Profilbilder liegen in einem eigenen Bereich. */
  avatare: number;
  anzahl: number;
  grenze: number;
  projekte: Array<{ id: string; name: string; bytes: number; anzahl: number }>;
};

/**
 * Wie viel Speicher belegen die hochgeladenen Dateien.
 *
 * Nur für die Swiss Solar Ventures AG: Ein Lieferant erführe hieraus, wie viel
 * die anderen Firmen eingestellt haben.
 */
export default function StorageModal({ onClose }: { onClose: () => void }) {
  const { reportError } = useFeedback();
  const [daten, setDaten] = useState<Belegung | null>(null);

  const laden = useCallback(async () => {
    try {
      setDaten(await api<Belegung>('/api/storage'));
    } catch (error) {
      reportError(error, 'Die Speicherbelegung konnte nicht geladen werden.');
      onClose();
    }
  }, [reportError, onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  const anteil = daten ? Math.min(100, (daten.gesamt / daten.grenze) * 100) : 0;
  // Ab drei Vierteln lohnt sich ein Blick, ab neun Zehnteln wird es eng.
  const farbe = anteil >= 90 ? 'var(--danger)' : anteil >= 75 ? '#e8a33d' : 'var(--accent)';

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <h3>Speicherplatz</h3>

        {!daten ? (
          <Spinner />
        ) : (
          <>
            <p style={{ marginBottom: 10 }}>
              <strong>{fmtSize(daten.gesamt)}</strong> von {fmtSize(daten.grenze)} belegt
              · {daten.anzahl} {daten.anzahl === 1 ? 'Datei' : 'Dateien'}
            </p>

            <div className="speicher-balken">
              <div
                className="speicher-fuellung"
                style={{ width: `${Math.max(anteil, 1)}%`, background: farbe }}
              />
            </div>

            {daten.papierkorb > 0 && (
              <p className="speicher-hinweis">
                Davon {fmtSize(daten.papierkorb)} im Papierkorb – endgültig löschen gibt
                den Platz wieder frei.
              </p>
            )}

            <div className="speicher-liste">
              {daten.projekte.length ? (
                daten.projekte.map((p) => (
                  <div key={p.id} className="speicher-zeile">
                    <span className="speicher-name" title={p.name}>
                      {p.name}
                    </span>
                    <span className="speicher-wert">
                      {fmtSize(p.bytes)}
                      <span className="speicher-anzahl"> · {p.anzahl}</span>
                    </span>
                  </div>
                ))
              ) : (
                <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                  Noch keine Dateien hochgeladen.
                </p>
              )}
            </div>

            {daten.datenbank !== null && (
              <div className="speicher-zeile" style={{ borderBottom: 'none' }}>
                <span className="speicher-name">
                  Datenbank <span className="speicher-anzahl">(eigenes Kontingent)</span>
                </span>
                <span className="speicher-wert">{fmtSize(daten.datenbank)}</span>
              </div>
            )}

            <p className="speicher-hinweis">
              {daten.ausSupabase
                ? 'Der Gesamtwert kommt von Supabase selbst – dieselbe Zahl wie im Dashboard. '
                : 'Zusammengezählt aus den Dateien im Speicher. Nach der Datenbank-Aktualisierung 0018 kommt der Wert direkt von Supabase. '}
              Enthalten sind Dokumente, Fotos, Vorschaubilder (
              {fmtSize(daten.vorschau)}) und Profilbilder ({fmtSize(daten.avatare)}).
              Fotos werden beim Hochladen automatisch auf rund 1 MB verkleinert,
              darum bleibt es lange klein.
            </p>

            <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Schliessen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
