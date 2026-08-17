'use client';

import { useState } from 'react';
import { fmtSize } from '@/lib/format';
import { vorabZuGross, zuGrossText } from '@/lib/uploadLimit';

/** Dateiendung, damit sie beim Umbenennen nicht verloren geht. */
function endung(dateiname: string): string {
  const punkt = dateiname.lastIndexOf('.');
  return punkt > 0 ? dateiname.slice(punkt) : '';
}

/** Vorschlag: der bisherige Name ohne Endung. */
function ohneEndung(dateiname: string): string {
  const punkt = dateiname.lastIndexOf('.');
  return punkt > 0 ? dateiname.slice(0, punkt) : dateiname;
}

/**
 * Fragt vor dem Hochladen nach einem sprechenden Namen.
 *
 * Was der Fotoapparat oder Windows liefert ("IMG_4711.jpg", "OFFERT~1.PDF"),
 * sagt später niemandem mehr etwas. Die Endung hängt die Ansicht selbst an,
 * damit die Datei überall richtig geöffnet wird.
 */
export default function UploadNamesModal({
  files,
  titel,
  mitBetrag = false,
  onAbbrechen,
  onBestaetigen,
}: {
  files: File[];
  titel: string;
  /** Zeigt zusätzlich ein Feld für den Betrag – beim Einreichen von Offerten. */
  mitBetrag?: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (namen: string[], betraege: Array<number | null>) => void;
}) {
  const [namen, setNamen] = useState<string[]>(() =>
    files.map((f) => ohneEndung(f.name)),
  );
  const [betraege, setBetraege] = useState<string[]>(() => files.map(() => ''));

  const vollstaendig = namen.every((n) => n.trim().length > 0);

  // Bilder werden vor dem Hochladen verkleinert – bei ihnen sagt die rohe
  // Grösse nichts aus. Gemeldet wird deshalb nur, was sicher zu gross bleibt.
  const zuGross = files.filter(vorabZuGross);

  /** "12'400.50", "12400,50" und "12400" ergeben alle dieselbe Zahl. */
  function alsZahl(roh: string): number | null {
    const wert = roh.replace(/['\s]/g, '').replace(',', '.').trim();
    if (!wert) return null;
    const zahl = Number(wert);
    return Number.isFinite(zahl) && zahl >= 0 ? Math.round(zahl * 100) / 100 : null;
  }

  function absenden() {
    if (!vollstaendig) return;
    onBestaetigen(
      namen.map((n, i) => `${n.trim()}${endung(files[i].name)}`),
      betraege.map(alsZahl),
    );
  }

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onAbbrechen();
      }}
    >
      <div className="modal" style={{ maxWidth: 560 }}>
        <h3>{titel}</h3>
        <p>
          {files.length === 1
            ? 'Gib der Datei einen Namen, unter dem sie alle wiederfinden.'
            : `Gib den ${files.length} Dateien Namen, unter denen sie alle wiederfinden.`}
        </p>

        {files.map((f, i) => (
          <div className="upload-name-zeile" key={`${f.name}-${i}`}>
            <div className="upload-name-datei" title={f.name}>
              📎 {f.name} · {fmtSize(f.size)}
            </div>
            {vorabZuGross(f) && (
              <div className="upload-zu-gross">⚠️ {zuGrossText(f.size)}</div>
            )}
            <div className="upload-name-eingabe">
              <input
                type="text"
                value={namen[i]}
                autoFocus={i === 0}
                placeholder="z.B. Offerte Gartenbau, Fassade Nordseite"
                onChange={(e) =>
                  setNamen((current) =>
                    current.map((n, j) => (j === i ? e.target.value : n)),
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') absenden();
                }}
              />
              <span className="upload-name-endung">{endung(f.name)}</span>
            </div>

            {/* Bei Offerten gleich den Betrag erfassen. Aus PDF wird er wenn
                möglich automatisch gelesen – dieses Feld hat Vorrang. */}
            {mitBetrag && (
              <div className="upload-name-eingabe" style={{ marginTop: 6 }}>
                <input
                  type="text"
                  inputMode="decimal"
                  value={betraege[i]}
                  placeholder="z.B. 152'000"
                  onChange={(e) =>
                    setBetraege((current) =>
                      current.map((b, j) => (j === i ? e.target.value : b)),
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') absenden();
                  }}
                />
                <span className="upload-name-endung">exkl. MWST, CHF</span>
              </div>
            )}
          </div>
        ))}

        <div className="form-actions" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onAbbrechen}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn btn-accent"
            onClick={absenden}
            disabled={!vollstaendig || zuGross.length === files.length}
          >
            {zuGross.length && zuGross.length < files.length
              ? `Übrige ${files.length - zuGross.length} hochladen`
              : 'Hochladen'}
          </button>
        </div>
      </div>
    </div>
  );
}
