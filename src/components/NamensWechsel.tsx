'use client';

import { useEffect, useState } from 'react';

/**
 * Der Namenswechsel, einmal gezeigt.
 *
 * Aus der Swiss Solar Ventures AG ist die Swiss Sustainable Ventures AG
 * geworden. Beim Öffnen der App erscheint deshalb kurz das alte Logo und
 * wechselt auf das neue.
 *
 * Warum überhaupt: Ein Firmenname, der sich über Nacht ändert, verunsichert –
 * "bin ich hier richtig?". Die drei Sekunden beantworten das, bevor die Frage
 * entsteht. Danach ist es erledigt.
 *
 * Deshalb EINMAL je Sitzung und nicht bei jedem Klick. Eine Einblendung, die
 * man zehnmal am Tag wegwartet, ist nach dem zweiten Mal keine Mitteilung
 * mehr, sondern eine Hürde. Gemerkt wird das im sessionStorage: Wer den
 * Browser schliesst und morgen wiederkommt, sieht es nochmals – ein paar Tage
 * lang ist das richtig, und dann nehme ich es wieder heraus.
 *
 * Beide Logos sind gleich hoch und zeigen dasselbe Haus an derselben Stelle;
 * nur das mittlere Wort ist ein anderes. Deshalb genügt ein Überblenden: Es
 * sieht aus, als würde sich das Wort austauschen, und nicht, als würden zwei
 * Bilder gewechselt.
 *
 * Wer nicht warten will, klickt – dann ist sie sofort vorbei. Und wer im
 * Betriebssystem weniger Bewegung eingestellt hat, bekommt sie gar nicht
 * erst: Für solche Leute ist eine Einblendung kein Gruss, sondern Unwohlsein.
 */
const GEZEIGT = 'baukoordination.namenswechsel.2026';

export default function NamensWechsel() {
  /**
   * Was gerade zu sehen ist.
   *
   * 'aus'  – nichts, die Animation ist vorbei oder findet nicht statt
   * 'alt'  – das alte Logo steht
   * 'neu'  – das neue ist eingeblendet
   * 'weg'  – die ganze Fläche blendet aus
   */
  const [stand, setStand] = useState<'pruefe' | 'alt' | 'neu' | 'weg' | 'aus'>(
    'pruefe',
  );

  useEffect(() => {
    const zeiten: number[] = [];

    /**
     * Erst im nächsten Durchgang entscheiden.
     *
     * Direkt im Effekt gesetzt, löste der erste Zustand eine zweite
     * Zeichnung aus, noch bevor die erste fertig war – React weist das zu
     * Recht zurück. Ein Schritt Verzögerung genügt, und sichtbar ist davon
     * nichts.
     */
    zeiten.push(
      window.setTimeout(() => {
        let schonGesehen = true;
        try {
          schonGesehen = window.sessionStorage.getItem(GEZEIGT) === 'ja';
        } catch {
          // Privates Fenster oder blockierte Speicherung: dann lieber nicht
          // zeigen, als sie bei jedem Seitenwechsel erneut zu zeigen.
        }

        const wenigerBewegung = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;

        if (schonGesehen || wenigerBewegung) {
          setStand('aus');
          return;
        }

        try {
          window.sessionStorage.setItem(GEZEIGT, 'ja');
        } catch {
          // Dann eben jedes Mal – immer noch besser als gar nicht zu starten.
        }

        setStand('alt');

        // Erst das alte Logo stehen lassen, dann überblenden, kurz halten,
        // ausblenden. Die Zeiten sind so gewählt, dass man den Wechsel sieht,
        // ohne auf ihn zu warten.
        zeiten.push(window.setTimeout(() => setStand('neu'), 900));
        zeiten.push(window.setTimeout(() => setStand('weg'), 2600));
        zeiten.push(window.setTimeout(() => setStand('aus'), 3200));
      }, 0),
    );

    return () => {
      for (const z of zeiten) window.clearTimeout(z);
    };
  }, []);

  if (stand === 'aus' || stand === 'pruefe') return null;

  return (
    <div
      className={`namenswechsel ${stand === 'weg' ? 'weg' : ''}`}
      onClick={() => setStand('aus')}
      role="presentation"
    >
      <div className="namenswechsel-buehne">
        {/* Beide übereinander, gleich hoch, links bündig: Das Haus liegt in
            beiden an derselben Stelle, also bleibt es beim Überblenden
            stehen. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`namenswechsel-logo ${stand === 'alt' ? 'da' : ''}`}
          src="/logo-alt.png"
          alt=""
          aria-hidden="true"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`namenswechsel-logo ${stand !== 'alt' ? 'da' : ''}`}
          src="/logo.png"
          alt="Swiss Sustainable Ventures AG"
        />
      </div>

      <div className={`namenswechsel-text ${stand !== 'alt' ? 'da' : ''}`}>
        Wir heissen neu <strong>Swiss Sustainable Ventures AG</strong>
      </div>
    </div>
  );
}
