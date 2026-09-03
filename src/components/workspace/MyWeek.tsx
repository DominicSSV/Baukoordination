'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, patch } from '@/lib/client/api';
import { fmtDate } from '@/lib/format';
import { fmtDueDate, heute } from '@/lib/due';
import { tagPlus } from '@/lib/schedule';
import { assigneeLabel } from '@/lib/assignee';
import { assigneePerson, personLabel } from '@/lib/people';
import Avatar from '@/components/Avatar';
import Spinner from '@/components/Spinner';
import { spieleMuenze, spieleSchade } from '@/lib/client/ton';
import type { MeineAufgabe } from '@/app/api/mytasks/route';
import type { AdminProfile, Supplier } from '@/types';

/** Die Fächer, in die eine Aufgabe nach ihrer Frist fällt. */
type Fach =
  | 'ueberfaellig'
  | 'heute'
  | 'woche'
  | 'naechste'
  | 'spaeter'
  | 'ohne'
  | 'erledigt';

const FAECHER: Array<{ wert: Fach; name: string; ton: string }> = [
  { wert: 'ueberfaellig', name: 'Überfällig', ton: 'rot' },
  { wert: 'heute', name: 'Heute fällig', ton: 'gelb' },
  { wert: 'woche', name: 'Diese Woche', ton: 'gruen' },
  { wert: 'naechste', name: 'Nächste Woche', ton: '' },
  { wert: 'spaeter', name: 'Später', ton: '' },
  { wert: 'ohne', name: 'Ohne Frist', ton: '' },
  // Steht zuletzt: Erledigtes ist Nachweis, nicht Arbeit. Und es hat ein
  // eigenes Fach, weil eine abgehakte Aufgabe mit alter Frist sonst unter
  // "Überfällig" stünde – überfällig ist sie aber gerade nicht mehr.
  { wert: 'erledigt', name: 'Erledigt', ton: '' },
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

function einordnen(a: MeineAufgabe): Fach {
  if (a.done) return 'erledigt';

  const due = a.dueDate;
  if (!due) return 'ohne';
  const heuteStr = heute();
  if (due < heuteStr) return 'ueberfaellig';
  if (due === heuteStr) return 'heute';

  const dieseWoche = wochenEnde(heuteStr);
  if (due <= dieseWoche) return 'woche';
  return due <= tagPlus(dieseWoche, 7) ? 'naechste' : 'spaeter';
}

/** Wo die Wahl der Schalter liegt, damit sie den Tagesbeginn übersteht. */
const SPEICHER = 'baukoordination.woche.nurMeine';
const SPEICHER_ERLEDIGT = 'baukoordination.woche.erledigte';

/** Liest einen gespeicherten Schalter. Fehlt oder klemmt der Speicher: Standard. */
function gemerkt(schluessel: string, standard: boolean): boolean {
  try {
    const wert = window.localStorage.getItem(schluessel);
    if (wert === null) return standard;
    return wert === 'ja';
  } catch {
    // Privates Fenster oder blockierte Speicherung – dann eben ohne Gedächtnis.
    return standard;
  }
}

function merken(schluessel: string, wert: boolean) {
  try {
    window.localStorage.setItem(schluessel, wert ? 'ja' : 'nein');
  } catch {
    // Nicht speichern zu können ist kein Grund, den Schalter nicht zu bedienen.
  }
}

/**
 * Startseite über alle Projekte: was steht an, sortiert nach Dringlichkeit.
 *
 * Der Schalter "Nur meine" entscheidet, ob hier nur die eigenen Aufgaben
 * stehen oder alles über alle Projekte. Standard sind die eigenen: Wer die
 * App öffnet, fragt zuerst nach der eigenen Arbeit. Die Wahl bleibt danach
 * gespeichert – wer sie einmal umgestellt hat, will sie nicht jeden Morgen
 * wieder umstellen.
 *
 * Der Schalter "Erledigte" holt die abgehakten Aufgaben dazu – in ein eigenes
 * Fach ganz unten. Standard ist aus: Die Frage lautet zuerst "was ist zu tun",
 * nicht "was war". Weggeräumtes bleibt in beiden Stellungen draussen; das ist
 * kein Nachweis, sondern ein Irrtum, den jemand ausgeräumt hat.
 *
 * Abhaken geht direkt hier – und rückgängig machen ebenso, sonst wäre ein
 * Fehlklick nur im Projekt zu beheben. Für alles Weitere führt ein Klick ins
 * Projekt.
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
  const [nurMeine, setNurMeine] = useState(() => gemerkt(SPEICHER, true));
  const [zeigeErledigte, setZeigeErledigte] = useState(() =>
    gemerkt(SPEICHER_ERLEDIGT, false),
  );

  function umschalten(wert: boolean) {
    setNurMeine(wert);
    merken(SPEICHER, wert);
  }

  /**
   * Anders als "Nur meine" braucht dieser Schalter eine neue Abfrage: Die
   * erledigten Aufgaben werden gar nicht erst mitgeliefert, solange man sie
   * nicht sehen will. Sie wachsen mit jedem Tag weiter, die offenen nicht.
   */
  const laden = useCallback(
    async (erledigte: boolean) => {
      try {
        const { aufgaben: neu } = await api<{ aufgaben: MeineAufgabe[] }>(
          erledigte ? '/api/mytasks?erledigte=1' : '/api/mytasks',
        );
        setAufgaben(neu);
      } catch (error) {
        reportError(error, 'Die Übersicht konnte nicht geladen werden.');
        setAufgaben([]);
      }
    },
    [reportError],
  );

  useEffect(() => {
    const start = window.setTimeout(() => void laden(zeigeErledigte), 0);
    return () => window.clearTimeout(start);
  }, [laden, zeigeErledigte]);

  function erledigteUmschalten(wert: boolean) {
    setZeigeErledigte(wert);
    merken(SPEICHER_ERLEDIGT, wert);
  }

  const sichtbar = useMemo(
    () => (aufgaben ?? []).filter((a) => !nurMeine || a.meine),
    [aufgaben, nurMeine],
  );

  const gruppiert = useMemo(() => {
    const map = new Map<Fach, MeineAufgabe[]>();
    for (const f of FAECHER) map.set(f.wert, []);
    for (const a of sichtbar) map.get(einordnen(a))!.push(a);
    return map;
  }, [sichtbar]);

  async function abhaken(a: MeineAufgabe) {
    setBusy(a.id);
    const neuErledigt = !a.done;
    if (neuErledigt) spieleMuenze();
    else spieleSchade();

    try {
      await patch(`/api/todos/${a.id}`, { done: neuErledigt });

      setAufgaben((current) =>
        (current ?? []).flatMap((x) => {
          if (x.id !== a.id) return [x];
          // Wer die Erledigten nicht sieht, für den verschwindet die Zeile –
          // sie stünde sonst abgehakt in einer Liste offener Aufgaben. Sonst
          // wandert sie ins Fach "Erledigt" und bleibt greifbar.
          if (neuErledigt && !zeigeErledigte) return [];
          return [
            {
              ...x,
              done: neuErledigt,
              doneAt: neuErledigt ? new Date().toISOString() : null,
            },
          ];
        }),
      );

      toast(neuErledigt ? '✓ Erledigt.' : '↩ Wieder offen.');
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

  // Gezählt wird, was ansteht. Erledigtes gehört nicht dazu – sonst stiege die
  // Zahl der "offenen Aufgaben", je mehr man abhakt.
  const offen = sichtbar.filter((a) => !a.done).length;
  const erledigt = sichtbar.length - offen;

  return (
    <div className="card">
      <div className="section-head">
        <h2>Meine To-Do&rsquo;s</h2>
        <div className="woche-schalter-reihe">
          <label className="woche-schalter">
            <input
              type="checkbox"
              checked={nurMeine}
              onChange={(e) => umschalten(e.target.checked)}
            />
            Nur meine
          </label>
          <label className="woche-schalter">
            <input
              type="checkbox"
              checked={zeigeErledigte}
              onChange={(e) => erledigteUmschalten(e.target.checked)}
            />
            Erledigte zeigen
          </label>
        </div>
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
        {zeigeErledigte && erledigt > 0 && ` ${erledigt} bereits erledigt.`}
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
              <div className={`woche-zeile ${a.done ? 'erledigt' : ''}`} key={a.id}>
                {/* Auch zurück: Ein Fehlklick wäre sonst nur im Projekt zu
                    beheben, und die Aufgabe ist ja hier gerade vor der Nase. */}
                <button
                  type="button"
                  className={`checkbox ${a.done ? 'checked' : ''}`}
                  onClick={() => abhaken(a)}
                  disabled={busy === a.id}
                  title={a.done ? 'Wieder als offen markieren' : 'Als erledigt markieren'}
                  aria-label={
                    a.done ? 'Wieder als offen markieren' : 'Als erledigt markieren'
                  }
                >
                  {a.done ? '✓' : ''}
                </button>
                {/* Der Knopf umschliesst nur den Text. Die Merkzeichen der
                    Zuständigen stehen daneben und nicht darin: Ein Bild in
                    einem Knopf ist kein gültiges HTML, und anklickbar müssen
                    sie ohnehin nicht sein. */}
                <div className="woche-inhalt">
                <button
                  type="button"
                  className="woche-text"
                  onClick={() => onOpenProject(a.projectId)}
                  title="Im Projekt öffnen"
                >
                  <span className="woche-aufgabe">{a.text}</span>
                  <span className="woche-meta">
                    {a.projectName}
                    {/* Bei einer erledigten Aufgabe zählt, wann sie erledigt
                        wurde – die Frist ist Vergangenheit, und "bis 12.08."
                        unter einem Häkchen liest sich wie ein Vorwurf. */}
                    {a.done
                      ? a.doneAt && ` · erledigt ${fmtDate(a.doneAt)}`
                      : a.dueDate && ` · bis ${fmtDueDate(a.dueDate)}`}
                    {a.done && a.doneBy && ` von ${a.doneBy}`}
                    {/* In der eigenen Liste zählt nur, wer ausser einem selbst
                        noch dran ist – der eigene Name auf jeder Zeile wäre
                        Lärm. Wer alles sieht, bekommt die Zuständigen darunter
                        als Merkzeichen. */}
                    {nurMeine &&
                      a.andere.length > 0 &&
                      ` · mit ${a.andere
                        .map((w) => assigneeLabel(w, admins, suppliers))
                        .join(', ')}`}
                  </span>
                </button>

                  {/* Über alle Projekte hinweg ist "wem gehört das" die erste
                      Frage. Mit Bild statt nur als Name: In einer langen Liste
                      erkennt man das Gesicht schneller als die Zeile. */}
                  {!nurMeine && (
                    <div className="woche-zustaendig">
                      {a.assignees.map((wert) => {
                        const person = assigneePerson({ admins, suppliers }, wert);
                        return (
                          <span
                            key={wert}
                            className="assignee-chip"
                            title={assigneeLabel(wert, admins, suppliers)}
                          >
                            <Avatar url={person.avatarUrl} name={person.name} size={18} />
                            {personLabel(person)}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
