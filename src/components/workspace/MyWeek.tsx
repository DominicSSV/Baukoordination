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

/**
 * Startseite über alle Projekte: was steht für mich an, sortiert nach
 * Dringlichkeit.
 *
 * Hier steht ausschliesslich, was einem selbst zugewiesen ist – aussortiert
 * schon auf dem Server. Erledigtes bleibt draussen, und Weggeräumtes ebenso:
 * Die Frage lautet "was ist zu tun", nicht "was war".
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

  const gruppiert = useMemo(() => {
    const map = new Map<Fach, MeineAufgabe[]>();
    for (const f of FAECHER) map.set(f.wert, []);
    for (const a of aufgaben ?? []) map.get(einordnen(a.dueDate))!.push(a);
    return map;
  }, [aufgaben]);

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

  const offen = aufgaben.length;

  return (
    <div className="card">
      <div className="section-head">
        <h2>Meine To-Do&rsquo;s</h2>
      </div>

      <p className="woche-hinweis">
        {offen
          ? `${offen} offene Aufgabe${offen === 1 ? '' : 'n'} über alle Projekte.`
          : 'Dir ist gerade nichts offen zugewiesen.'}
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
                    {/* An einem Gewerk sind oft zwei dran – dann ist es ein
                        Unterschied, ob man allein zuständig ist. */}
                    {a.andere.length > 0 &&
                      ` · mit ${a.andere
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
