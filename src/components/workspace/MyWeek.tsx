'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, patch } from '@/lib/client/api';
import { fmtDueDate, heute } from '@/lib/due';
import { tagPlus } from '@/lib/schedule';
import { assigneeLabel } from '@/lib/assignee';
import Spinner from '@/components/Spinner';
import { spieleMuenze } from '@/lib/client/ton';
import type { MeineAufgabe } from '@/app/api/mytasks/route';
import type { AdminProfile, Supplier } from '@/types';

/** Die Fächer, in die eine Aufgabe nach ihrer Frist fällt. */
type Fach = 'ueberfaellig' | 'heute' | 'woche' | 'naechste' | 'spaeter' | 'ohne';

const FAECHER: Array<{ wert: Fach; name: string; ton: string }> = [
  { wert: 'ueberfaellig', name: 'Überfällig', ton: 'rot' },
  { wert: 'heute', name: 'Heute fällig', ton: 'gelb' },
  { wert: 'woche', name: 'Diese Woche', ton: 'gruen' },
  { wert: 'naechste', name: 'Nächste Woche', ton: '' },
  { wert: 'spaeter', name: 'Später', ton: '' },
  { wert: 'ohne', name: 'Ohne Frist', ton: '' },
];

/**
 * Sonntag der Woche, in der dieser Tag liegt.
 *
 * Bewusst echte Kalenderwochen statt "in sieben Tagen": auf dem Bau wird in
 * Kalenderwochen gedacht, und am Freitag soll "diese Woche" nicht plötzlich
 * bis zum nächsten Donnerstag reichen.
 */
function wochenEnde(datum: string): string {
  const wochentag = (new Date(`${datum}T00:00:00`).getDay() + 6) % 7; // Mo=0 … So=6
  return tagPlus(datum, 6 - wochentag);
}

function einordnen(due: string | null): Fach {
  if (!due) return 'ohne';
  const heuteStr = heute();
  if (due < heuteStr) return 'ueberfaellig';
  if (due === heuteStr) return 'heute';

  const dieseWoche = wochenEnde(heuteStr);
  if (due <= dieseWoche) return 'woche';
  return due <= tagPlus(dieseWoche, 7) ? 'naechste' : 'spaeter';
}

/** Wo die Wahl des Schalters liegt, damit sie den Tagesbeginn übersteht. */
const SPEICHER = 'baukoordination.woche.nurMeine';

/**
 * Startseite über alle Projekte: was steht an, sortiert nach Dringlichkeit.
 *
 * Der Schalter "Nur meine" entscheidet, ob hier nur die eigenen Aufgaben
 * stehen oder alles über alle Projekte. Standard sind die eigenen: Wer die
 * App öffnet, fragt zuerst nach der eigenen Arbeit. Die Wahl bleibt danach
 * gespeichert – wer sie einmal umgestellt hat, will sie nicht jeden Morgen
 * wieder umstellen.
 *
 * Erledigtes bleibt draussen, und Weggeräumtes ebenso: Die Frage lautet "was
 * ist zu tun", nicht "was war".
 *
 * Abhaken geht direkt hier, für alles Weitere führt ein Klick ins Projekt.
 */
export default function MyWeek({
  admins,
  suppliers,
  onOpenProject,
}: {
  admins: AdminProfile[];
  suppliers: Supplier[];
  onOpenProject: (projectId: string) => void;
}) {
  const { reportError, toast } = useFeedback();
  const [aufgaben, setAufgaben] = useState<MeineAufgabe[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Beim ersten Aufbau lesen und nicht in einem Effekt nachziehen: Sonst
  // erschiene kurz die falsche Liste und spränge dann um.
  const [nurMeine, setNurMeine] = useState(() => {
    try {
      return window.localStorage.getItem(SPEICHER) !== 'nein';
    } catch {
      // Privates Fenster oder blockierte Speicherung – dann eben ohne Gedächtnis.
      return true;
    }
  });

  function umschalten(wert: boolean) {
    setNurMeine(wert);
    try {
      window.localStorage.setItem(SPEICHER, wert ? 'ja' : 'nein');
    } catch {
      // Nicht speichern zu können ist kein Grund, den Schalter nicht zu bedienen.
    }
  }

  const laden = useCallback(async () => {
    try {
      const { aufgaben: neu } = await api<{ aufgaben: MeineAufgabe[] }>(
        '/api/mytasks',
      );
      setAufgaben(neu);
    } catch (error) {
      reportError(error, 'Die Übersicht konnte nicht geladen werden.');
      setAufgaben([]);
    }
  }, [reportError]);

  useEffect(() => {
    const start = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(start);
  }, [laden]);

  const sichtbar = useMemo(
    () => (aufgaben ?? []).filter((a) => !nurMeine || a.meine),
    [aufgaben, nurMeine],
  );

  const gruppiert = useMemo(() => {
    const map = new Map<Fach, MeineAufgabe[]>();
    for (const f of FAECHER) map.set(f.wert, []);
    for (const a of sichtbar) map.get(einordnen(a.dueDate))!.push(a);
    return map;
  }, [sichtbar]);

  async function abhaken(a: MeineAufgabe) {
    setBusy(a.id);
    spieleMuenze();
    try {
      await patch(`/api/todos/${a.id}`, { done: true });
      // Ohne erneutes Laden bliebe die Zeile stehen, obwohl sie erledigt ist.
      setAufgaben((current) => (current ?? []).filter((x) => x.id !== a.id));
      toast('✓ Erledigt.');
    } catch (error) {
      reportError(error, 'Der Status konnte nicht geändert werden.');
    } finally {
      setBusy(null);
    }
  }

  if (!aufgaben) {
    return (
      <div className="empty-state">
        <Spinner size={56} />
        <p style={{ marginTop: 14 }}>Lade Aufgaben…</p>
      </div>
    );
  }

  const offen = sichtbar.length;

  return (
    <div className="card">
      <div className="section-head">
        <h2>Meine To-Do&rsquo;s</h2>
        <label className="woche-schalter">
          <input
            type="checkbox"
            checked={nurMeine}
            onChange={(e) => umschalten(e.target.checked)}
          />
          Nur meine
        </label>
      </div>

      <p className="woche-hinweis">
        {offen
          ? `${offen} offene Aufgabe${offen === 1 ? '' : 'n'} ${
              nurMeine ? 'für dich' : 'über alle Projekte'
            }.`
          : nurMeine
            ? 'Dir ist gerade nichts offen zugewiesen. Schalte „Nur meine“ aus, '
              + 'um alles zu sehen.'
            : 'Es ist nichts offen.'}
      </p>

      {FAECHER.map((fach) => {
        const liste = gruppiert.get(fach.wert) ?? [];
        if (!liste.length) return null;

        return (
          <div className="woche-fach" key={fach.wert}>
            <div className={`woche-titel ${fach.ton}`}>
              {fach.name}
              <span className="gruppe-anzahl">{liste.length}</span>
            </div>

            {liste.map((a) => (
              <div className="woche-zeile" key={a.id}>
                <button
                  type="button"
                  className="checkbox"
                  onClick={() => abhaken(a)}
                  disabled={busy === a.id}
                  title="Als erledigt markieren"
                  aria-label="Als erledigt markieren"
                />
                <button
                  type="button"
                  className="woche-text"
                  onClick={() => onOpenProject(a.projectId)}
                  title="Im Projekt öffnen"
                >
                  <span className="woche-aufgabe">{a.text}</span>
                  <span className="woche-meta">
                    {a.projectName}
                    {a.dueDate && ` · bis ${fmtDueDate(a.dueDate)}`}
                    {/* Bei den eigenen Aufgaben zählt, wer ausser einem selbst
                        noch dran ist – an einem Gewerk sind oft zwei zuständig.
                        Bei fremden zählt, wem sie überhaupt gehört. */}
                    {a.meine
                      ? a.andere.length > 0 &&
                        ` · mit ${a.andere
                          .map((w) => assigneeLabel(w, admins, suppliers))
                          .join(', ')}`
                      : ` · ${a.assignees
                          .map((w) => assigneeLabel(w, admins, suppliers))
                          .join(', ')}`}
                  </span>
                </button>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
