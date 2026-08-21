'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, post } from '@/lib/client/api';
import { useFeedback } from '@/components/Feedback';
import { fmtDate } from '@/lib/format';
import Avatar from '@/components/Avatar';
import { mitFirma } from '@/lib/people';
import type { Benachrichtigung, Ziel } from '@/app/api/notifications/route';

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

/**
 * Bis hierhin wurde die Glocke geleert – alles Ältere bleibt in der Liste
 * verborgen, bis man ausdrücklich alles anzeigen lässt.
 */
function leerSchluessel(id: string) {
  return `bk-geleert-${id}`;
}

/** Einzeln weggeklickte Einträge, als Liste ihrer Kennungen. */
function versteckSchluessel(id: string) {
  return `bk-versteckt-${id}`;
}

function ladeVersteckte(id: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const roh = window.localStorage.getItem(versteckSchluessel(id));
    const liste: unknown = roh ? JSON.parse(roh) : [];
    return new Set(Array.isArray(liste) ? liste.filter((x) => typeof x === 'string') : []);
  } catch {
    // Kaputter Eintrag im Speicher des Browsers ist kein Grund, die Glocke
    // lahmzulegen – dann ist eben nichts versteckt.
    return new Set();
  }
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
  istAdmin,
  onOpenProject,
}: {
  /** Eigene Kennung – trennt den gelesen-Stand verschiedener Anmeldungen. */
  werBinIch: string;
  /** Nur wir dürfen die Glocke anderer leeren. */
  istAdmin: boolean;
  onOpenProject: (projectId: string, ziel: Ziel) => void;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [offen, setOffen] = useState(false);
  const [eintraege, setEintraege] = useState<Benachrichtigung[]>([]);
  // Der gelesen-Stand kommt aus dem Browser. Auf dem Server gibt es ihn nicht;
  // das ist unkritisch, weil die Liste beim ersten Zeichnen ohnehin leer ist.
  const [gesehen, setGesehen] = useState<string>(() =>
    typeof window === 'undefined'
      ? ''
      : (window.localStorage.getItem(schluessel(werBinIch)) ?? ''),
  );
  const [geleertBis, setGeleertBis] = useState<string>(() =>
    typeof window === 'undefined'
      ? ''
      : (window.localStorage.getItem(leerSchluessel(werBinIch)) ?? ''),
  );
  const [versteckt, setVersteckt] = useState<Set<string>>(() =>
    ladeVersteckte(werBinIch),
  );
  /** true = auch zeigen, was weggeräumt wurde. */
  const [alleZeigen, setAlleZeigen] = useState(false);
  const feldRef = useRef<HTMLDivElement>(null);

  const laden = useCallback(async (alle = false) => {
    try {
      const { eintraege: neu } = await api<{ eintraege: Benachrichtigung[] }>(
        alle ? '/api/notifications?alle=1' : '/api/notifications',
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
    const sofort = window.setTimeout(() => void laden(alleZeigen), 0);
    const timer = window.setInterval(() => void laden(alleZeigen), INTERVALL);
    return () => {
      window.clearTimeout(sofort);
      window.clearInterval(timer);
    };
  }, [laden, alleZeigen]);

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

  /** Was weggeräumt wurde: zu alt für die Glocke oder einzeln weggeklickt. */
  const istWeggeraeumt = useCallback(
    (e: Benachrichtigung) =>
      (!!geleertBis && e.createdAt <= geleertBis) || versteckt.has(e.id),
    [geleertBis, versteckt],
  );

  const sichtbar = useMemo(
    () => (alleZeigen ? eintraege : eintraege.filter((e) => !istWeggeraeumt(e))),
    [eintraege, alleZeigen, istWeggeraeumt],
  );

  // Weggeräumtes zählt nicht mehr – sonst stünde an der Glocke eine Zahl, zu
  // der die Liste darunter nichts zeigt.
  const ungelesen = useMemo(
    () =>
      eintraege.filter(
        (e) => !istWeggeraeumt(e) && (!gesehen || e.createdAt > gesehen),
      ).length,
    [eintraege, gesehen, istWeggeraeumt],
  );

  function umschalten() {
    if (offen) {
      setOffen(false);
      return;
    }

    setOffen(true);
    void laden(alleZeigen);

    // Beim Öffnen gilt alles als gesehen – der neuste Eintrag ist die Marke.
    const neuster = eintraege[0]?.createdAt;
    if (neuster && neuster > gesehen) {
      window.localStorage.setItem(schluessel(werBinIch), neuster);
      setGesehen(neuster);
    }
  }

  /**
   * Leeren heisst ausblenden, nicht löschen: Gemerkt wird nur der Zeitpunkt des
   * neusten Eintrags. Das Protokoll selbst bleibt unangetastet – dort hängen
   * Fotos, Offerten und Terminänderungen dran, die niemand versehentlich mit
   * einem Klick auf die Glocke verlieren soll.
   */
  function leeren() {
    const neuster = eintraege[0]?.createdAt;
    if (!neuster) return;

    window.localStorage.setItem(leerSchluessel(werBinIch), neuster);
    setGeleertBis(neuster);
    setAlleZeigen(false);
  }

  /**
   * Einen einzelnen Eintrag wegklicken – ebenfalls nur ausblenden.
   *
   * Die neue Liste wird hier gebildet und erst dann gespeichert. In die
   * Zustandsfunktion gehört das Schreiben nicht: React darf sie mehrfach
   * aufrufen, und Nebenwirkungen liefen dann doppelt.
   */
  function verstecken(id: string) {
    const neu = new Set(versteckt);
    neu.add(id);
    window.localStorage.setItem(
      versteckSchluessel(werBinIch),
      JSON.stringify([...neu]),
    );
    setVersteckt(neu);
  }

  /** Alles Weggeräumte wieder in die Glocke holen. */
  function wiederherstellen() {
    window.localStorage.removeItem(leerSchluessel(werBinIch));
    window.localStorage.removeItem(versteckSchluessel(werBinIch));
    setGeleertBis('');
    setVersteckt(new Set());
  }

  /**
   * Die Glocke aller anderen leeren – die eigene bleibt, wie sie ist.
   *
   * Gedacht für den Rückstand aus der Aufbauzeit: Bei allen Beteiligten liegen
   * hunderte Einträge, die niemanden mehr betreffen. Gelöscht wird nichts, die
   * Einträge sind für die Betroffenen weiterhin unter "Alle anzeigen" da.
   */
  function fuerAlleLeeren() {
    confirm(
      'Die Glocke aller anderen auf null setzen? Deine eigene bleibt, wie sie ' +
        'ist. Gelöscht wird nichts – die Einträge bleiben im Protokoll und für ' +
        'die Betroffenen unter „Alle anzeigen“ auffindbar.',
      async () => {
        try {
          const res = await post<{ beiUns: number; lieferanten: number }>(
            '/api/notifications/leeren',
            { andere: true },
          );
          toast(
            `✓ Geleert: ${res.beiUns} bei uns, ${res.lieferanten} Lieferanten.`,
          );
        } catch (error) {
          reportError(error, 'Leeren fehlgeschlagen.');
        }
      },
    );
  }

  function alleUmschalten() {
    const neu = !alleZeigen;
    setAlleZeigen(neu);
    void laden(neu);
  }

  const weggeraeumt = eintraege.filter(istWeggeraeumt).length;

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
        {/* Eigenes Zeichen statt des Emojis: das war je nach Betriebssystem
            dunkelbraun und ging auf der dunklen Leiste unter. */}
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <path d="M10.5 20a1.9 1.9 0 0 0 3 0" />
        </svg>
        {ungelesen > 0 && (
          <span className="glocke-zahl">{ungelesen > 9 ? '9+' : ungelesen}</span>
        )}
      </button>

      {offen && (
        <div className="glocke-liste" role="menu">
          <div className="glocke-kopf">
            <strong>{alleZeigen ? 'Alle Benachrichtigungen' : 'Benachrichtigungen'}</strong>
            <span className="glocke-kopf-rechts">
              {ungelesen > 0 && <span className="glocke-laedt">{ungelesen} neu</span>}
              {!alleZeigen && sichtbar.length > 0 && (
                <button type="button" className="glocke-aktion" onClick={leeren}>
                  Leeren
                </button>
              )}
              {alleZeigen && weggeraeumt > 0 && (
                <button
                  type="button"
                  className="glocke-aktion"
                  onClick={wiederherstellen}
                >
                  Alle zurückholen
                </button>
              )}
              {alleZeigen && istAdmin && (
                <button
                  type="button"
                  className="glocke-aktion"
                  onClick={fuerAlleLeeren}
                >
                  Für alle ausser mir leeren
                </button>
              )}
            </span>
          </div>

          {sichtbar.length ? (
            sichtbar.map((e) => {
              const neu = !gesehen || e.createdAt > gesehen;
              const weg = istWeggeraeumt(e);

              return (
                <div
                  key={e.id}
                  className={`glocke-zeile ${weg ? 'weggeraeumt' : ''} ${
                    neu && !weg ? 'neu' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="glocke-eintrag"
                    onClick={() => {
                      onOpenProject(e.projectId, e.ziel);
                      setOffen(false);
                    }}
                  >
                    <Avatar url={e.actorAvatarUrl} name={e.actorName} size={30} />
                    <span className="glocke-text">
                      <span className="glocke-satz">
                        <strong>{mitFirma(e.actorName, e.actorFirma)}</strong> {e.text}
                      </span>
                      <span className="glocke-meta">
                        {e.projectName} · {vorZeit(e.createdAt)}
                        {weg && ' · weggeräumt'}
                      </span>
                    </span>
                  </button>

                  {!weg && (
                    <button
                      type="button"
                      className="glocke-weg"
                      onClick={() => verstecken(e.id)}
                      title="Wegräumen – bleibt unter „Alle anzeigen“ auffindbar"
                      aria-label="Wegräumen"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })
          ) : (
            <p className="glocke-leer">
              {alleZeigen ? 'Es gibt noch nichts.' : 'Nichts Neues.'}
            </p>
          )}

          {/* Weggeräumtes ist nie weg – hier kommt es zurück ans Licht. */}
          <button type="button" className="glocke-fuss" onClick={alleUmschalten}>
            {alleZeigen
              ? '← Nur Neues zeigen'
              : `Alle anzeigen${weggeraeumt ? ` (${weggeraeumt} weggeräumt)` : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
