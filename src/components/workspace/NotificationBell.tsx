'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import Avatar from '@/components/Avatar';
import type { Benachrichtigung } from '@/app/api/notifications/route';

/** Wie oft im Hintergrund nachgeschaut wird. */
const INTERVALL = 60_000;

/**
 * Zeitpunkt des letzten Öffnens. Bewusst im Browser gespeichert statt in der
 * Datenbank: dafür bräuchte es eine weitere Migration, und der Nutzen wäre nur,
 * dass der gelesen-Stand zwischen Geräten wandert.
 */
function schluessel(id: string) {
  return `bk-gesehen-${id}`;
}

function vorZeit(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minuten = Math.round(diff / 60_000);
  if (minuten < 1) return 'gerade eben';
  if (minuten < 60) return `vor ${minuten} Min.`;

  const stunden = Math.round(minuten / 60);
  if (stunden < 24) return `vor ${stunden} Std.`;

  const tage = Math.round(stunden / 24);
  if (tage <= 7) return `vor ${tage} ${tage === 1 ? 'Tag' : 'Tagen'}`;
  return fmtDate(iso);
}

export default function NotificationBell({
  werBinIch,
  onOpenProject,
}: {
  /** Eigene Kennung – trennt den gelesen-Stand verschiedener Anmeldungen. */
  werBinIch: string;
  onOpenProject: (projectId: string) => void;
}) {
  const [offen, setOffen] = useState(false);
  const [eintraege, setEintraege] = useState<Benachrichtigung[]>([]);
  // Der gelesen-Stand kommt aus dem Browser. Auf dem Server gibt es ihn nicht;
  // das ist unkritisch, weil die Liste beim ersten Zeichnen ohnehin leer ist.
  const [gesehen, setGesehen] = useState<string>(() =>
    typeof window === 'undefined'
      ? ''
      : (window.localStorage.getItem(schluessel(werBinIch)) ?? ''),
  );
  const feldRef = useRef<HTMLDivElement>(null);

  const laden = useCallback(async () => {
    try {
      const { eintraege: neu } = await api<{ eintraege: Benachrichtigung[] }>(
        '/api/notifications',
      );
      setEintraege(neu);
    } catch {
      // Ein fehlgeschlagener Abruf im Hintergrund ist kein Grund für eine
      // Fehlermeldung – beim nächsten Durchlauf klappt es vielleicht wieder.
    }
  }, []);

  useEffect(() => {
    // Der erste Abruf läuft bewusst erst nach dem Zeichnen: die Glocke soll das
    // Aufbauen der Seite nicht aufhalten.
    const sofort = window.setTimeout(() => void laden(), 0);
    const timer = window.setInterval(() => void laden(), INTERVALL);
    return () => {
      window.clearTimeout(sofort);
      window.clearInterval(timer);
    };
  }, [laden]);

  // Schliessen bei Klick daneben und mit Escape.
  useEffect(() => {
    if (!offen) return;

    function beiKlick(e: MouseEvent) {
      if (!feldRef.current?.contains(e.target as Node)) setOffen(false);
    }
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') setOffen(false);
    }

    document.addEventListener('mousedown', beiKlick);
    document.addEventListener('keydown', beiTaste);
    return () => {
      document.removeEventListener('mousedown', beiKlick);
      document.removeEventListener('keydown', beiTaste);
    };
  }, [offen]);

  const ungelesen = useMemo(
    () => eintraege.filter((e) => !gesehen || e.createdAt > gesehen).length,
    [eintraege, gesehen],
  );

  function umschalten() {
    if (offen) {
      setOffen(false);
      return;
    }

    setOffen(true);
    void laden();

    // Beim Öffnen gilt alles als gesehen – der neuste Eintrag ist die Marke.
    const neuster = eintraege[0]?.createdAt;
    if (neuster && neuster > gesehen) {
      window.localStorage.setItem(schluessel(werBinIch), neuster);
      setGesehen(neuster);
    }
  }

  return (
    <div className="glocke" ref={feldRef}>
      <button
        type="button"
        className="glocke-knopf"
        onClick={umschalten}
        title="Benachrichtigungen"
        aria-label={
          ungelesen ? `${ungelesen} neue Benachrichtigungen` : 'Benachrichtigungen'
        }
        aria-expanded={offen}
      >
        🔔
        {ungelesen > 0 && (
          <span className="glocke-zahl">{ungelesen > 9 ? '9+' : ungelesen}</span>
        )}
      </button>

      {offen && (
        <div className="glocke-liste" role="menu">
          <div className="glocke-kopf">
            <strong>Benachrichtigungen</strong>
            {ungelesen > 0 && (
              <span className="glocke-laedt">{ungelesen} neu</span>
            )}
          </div>

          {eintraege.length ? (
            eintraege.map((e) => {
              const neu = !gesehen || e.createdAt > gesehen;

              return (
                <button
                  key={e.id}
                  type="button"
                  className={`glocke-eintrag ${neu ? 'neu' : ''}`}
                  onClick={() => {
                    onOpenProject(e.projectId);
                    setOffen(false);
                  }}
                >
                  <Avatar url={e.actorAvatarUrl} name={e.actorName} size={30} />
                  <span className="glocke-text">
                    <span className="glocke-satz">
                      <strong>{e.actorName}</strong> {e.text}
                    </span>
                    <span className="glocke-meta">
                      {e.projectName} · {vorZeit(e.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })
          ) : (
            <p className="glocke-leer">Nichts Neues.</p>
          )}
        </div>
      )}
    </div>
  );
}
