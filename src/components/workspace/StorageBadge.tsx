'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { fmtSize } from '@/lib/format';

/**
 * Ab hier wird es eng. Bis 75 Prozent grün, danach orange, ab 95 rot – so sieht
 * man am Rand des Blickfelds, ob man sich um den Speicher kümmern muss.
 */
const ORANGE_AB = 75;
const ROT_AB = 95;

function farbe(anteil: number): string {
  if (anteil >= ROT_AB) return '#E5484D';
  if (anteil >= ORANGE_AB) return '#E8A33D';
  return '#00BF63';
}

/**
 * Speicherkarte in der Leiste oben: Sie füllt sich von unten mit dem belegten
 * Anteil und wechselt die Farbe, wenn es knapp wird.
 *
 * Nur für die Swiss Solar Ventures AG – die Route dahinter verlangt ebenfalls
 * Adminrechte, hier wird das Symbol lediglich gar nicht erst gezeigt.
 */
export default function StorageBadge({
  onOeffnen,
  /** Wird hochgezählt, wenn sich etwas geändert haben könnte – dann neu laden. */
  stand,
}: {
  onOeffnen: () => void;
  stand: number;
}) {
  const [belegung, setBelegung] = useState<{ anteil: number; text: string } | null>(
    null,
  );

  useEffect(() => {
    let abgebrochen = false;

    // Erst nach dem Aufbau fragen: Die Leiste soll ohne Warten stehen, die
    // Karte füllt sich nach.
    const t = window.setTimeout(() => {
      void api<{ gesamt: number; grenze: number }>('/api/storage')
        .then((res) => {
          if (abgebrochen || !res.grenze) return;
          setBelegung({
            anteil: Math.min(100, (res.gesamt / res.grenze) * 100),
            text: `${fmtSize(res.gesamt)} von ${fmtSize(res.grenze)} belegt`,
          });
        })
        .catch(() => {
          // Kein Grund, die Leiste mit einer Fehlermeldung zu belasten – dann
          // bleibt die Karte eben leer.
        });
    }, 0);

    return () => {
      abgebrochen = true;
      window.clearTimeout(t);
    };
  }, [stand]);

  const anteil = belegung?.anteil ?? 0;
  // Der Innenraum der Karte reicht von y=4.5 bis y=20.5.
  const hoehe = (16 * anteil) / 100;

  return (
    <button
      type="button"
      className="topbar-icon"
      onClick={onOeffnen}
      title={
        belegung
          ? `Speicherplatz – ${belegung.text} (${Math.round(anteil)} %)`
          : 'Speicherplatz'
      }
      aria-label="Speicherplatz"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          {/* Die Füllung soll die Form der Karte annehmen, nicht darüber
              hinausragen – deshalb wird sie an der Kontur beschnitten. */}
          <clipPath id="speicherkarte">
            <path d="M7 2h7l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          </clipPath>
        </defs>

        <g clipPath="url(#speicherkarte)">
          <rect x="0" y="0" width="24" height="24" fill="rgba(255,255,255,0.16)" />
          {anteil > 0 && (
            <rect
              x="0"
              y={20.5 - hoehe}
              width="24"
              height={hoehe + 3}
              fill={farbe(anteil)}
            />
          )}
        </g>

        <path
          d="M7 2h7l4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        {/* Die Kontaktstreifen machen aus dem Rechteck erst eine Speicherkarte. */}
        <path
          d="M8.5 5v2.5M11 5v2.5M13.5 5v2.5"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
