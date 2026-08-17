'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import Spinner from '@/components/Spinner';
import type { Treffer } from '@/app/api/search/route';
import type { TabKey } from '@/components/workspace/Workspace';

const SYMBOL: Record<Treffer['art'], string> = {
  projekt: '🏗️',
  todo: '📝',
  datei: '📎',
  arbeit: '📅',
  lieferant: '👤',
};

const GRUPPE: Record<Treffer['art'], string> = {
  projekt: 'Projekte',
  todo: 'To-Dos',
  arbeit: 'Terminplan',
  datei: 'Dateien',
  lieferant: 'Lieferanten',
};

const REIHENFOLGE: Treffer['art'][] = ['projekt', 'todo', 'arbeit', 'datei', 'lieferant'];

/**
 * Suche über alles, was zum angemeldeten Konto gehört.
 *
 * Was gefunden wird, entscheidet die Datenbank: Die Route fragt mit den Rechten
 * der angemeldeten Person, ein Lieferant findet also nur, was er ohnehin sehen
 * darf. Diese Ansicht filtert nichts nach.
 */
export default function SearchModal({
  onClose,
  onOeffnen,
}: {
  onClose: () => void;
  onOeffnen: (projectId: string, ziel: TabKey) => void;
}) {
  const [begriff, setBegriff] = useState('');
  /**
   * Das gesuchte Wort wird beim Ergebnis mitgeführt. So lässt sich beim
   * Zeichnen erkennen, ob die Liste noch zum Eingabefeld passt – sonst blitzte
   * beim Weitertippen kurz das Ergebnis des vorherigen Begriffs auf.
   */
  const [ergebnis, setErgebnis] = useState<{ wort: string; liste: Treffer[] } | null>(
    null,
  );
  const feld = useRef<HTMLInputElement>(null);

  // Erst kurz warten, statt bei jedem Tastendruck zu fragen – sonst schickt
  // schon „Baubewilligung“ ein Dutzend Abfragen los.
  useEffect(() => {
    const wort = begriff.trim();
    if (wort.length < 2) return;

    let abgebrochen = false;

    const t = window.setTimeout(() => {
      void api<{ treffer: Treffer[] }>(`/api/search?q=${encodeURIComponent(wort)}`)
        .then((res) => {
          if (!abgebrochen) setErgebnis({ wort, liste: res.treffer });
        })
        .catch(() => {
          if (!abgebrochen) setErgebnis({ wort, liste: [] });
        });
    }, 250);

    return () => {
      abgebrochen = true;
      window.clearTimeout(t);
    };
  }, [begriff]);

  const wort = begriff.trim();
  const treffer = ergebnis?.wort === wort ? ergebnis.liste : null;

  useEffect(() => {
    const t = window.setTimeout(() => feld.current?.focus(), 0);
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', beiTaste);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', beiTaste);
    };
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal suche-modal">
        <input
          ref={feld}
          type="text"
          className="suche-feld"
          value={begriff}
          placeholder="Suchen – Projekt, To-Do, Datei, Arbeit, Lieferant…"
          onChange={(e) => setBegriff(e.target.value)}
        />

        {wort.length < 2 ? (
          <p className="suche-hinweis">Mindestens zwei Zeichen eingeben.</p>
        ) : !treffer ? (
          <Spinner size={30} />
        ) : !treffer.length ? (
          <p className="suche-hinweis">Nichts gefunden.</p>
        ) : (
          REIHENFOLGE.map((art) => {
            const teil = treffer.filter((t) => t.art === art);
            if (!teil.length) return null;

            return (
              <div key={art}>
                <div className="suche-gruppe">{GRUPPE[art]}</div>
                {teil.map((t) => (
                  <button
                    key={`${t.art}-${t.id}`}
                    type="button"
                    className="suche-treffer"
                    onClick={() => {
                      // Ein Lieferant hängt an keinem einzelnen Projekt – dort
                      // führt der Treffer ins zuletzt geöffnete.
                      onOeffnen(t.projectId, t.ziel);
                      onClose();
                    }}
                  >
                    <span className="suche-symbol" aria-hidden="true">
                      {SYMBOL[t.art]}
                    </span>
                    <span className="suche-text">
                      <span className="suche-titel">{t.titel}</span>
                      <span className="suche-meta">
                        {[t.projektName, t.zusatz].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
