'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { api, del, patch, post } from '@/lib/client/api';
import {
  PROJEKT_STATUS,
  type Project,
  type ProjektGruppe,
  type ProjektStatus,
} from '@/types';

const STANDARD_STATUS: ProjektStatus = 'umsetzung';

/**
 * Schluessel fuer die Sammelstelle am Ende.
 *
 * Kein echter Datensatz: Projekte ohne Sparte landen hier, damit sie sichtbar
 * bleiben. Eine Gliederung, die Projekte unsichtbar macht, richtet mehr
 * Schaden an, als sie Ordnung bringt.
 */
const OHNE_SPARTE = '__ohne__';

export default function Sidebar({
  projects,
  activeId,
  isAdmin,
  wocheAktiv,
  onWoche,
  onSelect,
  onCreate,
  onReordered,
  onPapierkorb,
  onKontakte,
  onNachrichten,
}: {
  projects: Project[];
  activeId: string | null;
  isAdmin: boolean;
  /** true = die projektübergreifende Übersicht ist offen. */
  wocheAktiv: boolean;
  onWoche: () => void;
  onSelect: (id: string) => void;
  onCreate: (name: string, ort: string) => Promise<void>;
  onReordered: (projects: Project[]) => void;
  /** Öffnet den Papierkorb über alle Projekte – nur für uns sichtbar. */
  onPapierkorb: () => void;
  /** Öffnet die Kontaktliste – nur für uns sichtbar. */
  onKontakte: () => void;
  /** Öffnet die Texte der verschickten Mails – nur für uns sichtbar. */
  onNachrichten: () => void;
}) {
  const { reportError, confirm } = useFeedback();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [ort, setOrt] = useState('');
  const [busy, setBusy] = useState(false);

  // Abgeschlossene Projekte sind standardmässig eingeklappt – sie stehen
  // im Alltag nur im Weg.
  /**
   * Was von Hand auf- oder zugeklappt wurde. Schluessel ist "<sparte>:<phase>":
   * Wer "Abgeschlossen" bei PVA zuklappt, will es bei BESS nicht auch zu haben.
   *
   * Nur die bewussten Entscheidungen stehen hier. Alles andere ergibt sich aus
   * dem Inhalt – siehe istEingeklappt.
   */
  const [zu, setZu] = useState<Map<string, boolean>>(new Map());

  /**
   * Ist diese Phase eingeklappt?
   *
   * Von Hand entschieden schlaegt alles. Sonst gilt: Eine leere Phase ist zu.
   * Ist bei PVA nichts in Planung, soll die Ueberschrift nicht mit einer leeren
   * Flaeche darunter den halben Bildschirm fuellen – bei fuenf Sparten waeren
   * das zwanzig Ueberschriften fuer nichts.
   *
   * "Abgeschlossen" bleibt ebenfalls zu, auch wenn etwas darin liegt: Im Alltag
   * steht es nur im Weg, und wer nachsehen will, klappt es auf.
   */
  function istEingeklappt(schluessel: string, phase: ProjektStatus, anzahl: number) {
    const vonHand = zu.get(schluessel);
    if (vonHand !== undefined) return vonHand;
    return anzahl === 0 || phase === 'abgeschlossen';
  }

  const [gezogen, setGezogen] = useState<string | null>(null);
  const [ueber, setUeber] = useState<{ id: string; status: ProjektStatus } | null>(null);

  /** Die Sparten aus der Datenbank – PVA, BESS, Heizung … */
  const [gruppen, setGruppen] = useState<ProjektGruppe[]>([]);
  const [sparteZu, setSparteZu] = useState<Set<string>>(new Set());
  /**
   * Welche Sparte gerade umbenannt wird, und der Entwurf dazu.
   *
   * An Ort und Stelle und nicht ueber window.prompt: Der Rest der App benutzt
   * eigene Dialoge, damit das Aussehen zusammenpasst - und auf dem Handy wird
   * ein prompt je nach Browser gar nicht oder als haessliche Systemleiste
   * angezeigt.
   */
  const [benennt, setBenennt] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');
  const [neueGruppe, setNeueGruppe] = useState<string | null>(null);

  /**
   * Auf dem Handy eingeklappt, sobald ein Projekt offen ist.
   *
   * Die Liste stand dort über dem Inhalt und nahm zwei Drittel des Bildschirms
   * ein – man scrollte an allen Projekten vorbei, um zu dem einen zu kommen,
   * das man gerade offen hatte. Am Rechner spielt das keine Rolle: Dort steht
   * die Liste in der Spalte daneben, und die Regel greift gar nicht erst.
   */
  const [listeOffen, setListeOffen] = useState(!activeId);

  // Bei offener To-Do-Übersicht steht kein Projekt im Inhalt – dann darf der
  // Wähler auch keines behaupten, sonst zeigt er auf etwas anderes als das,
  // was man gerade vor sich hat.
  const aktivesProjekt = wocheAktiv
    ? null
    : (projects.find((p) => p.id === activeId) ?? null);

  /** Eine Liste Projekte nach Phase aufteilen. */
  function phasenVon(liste: Project[]) {
    const map = new Map<ProjektStatus, Project[]>();
    for (const st of PROJEKT_STATUS) map.set(st.wert, []);
    for (const p of liste) {
      const status = (p.status ?? STANDARD_STATUS) as ProjektStatus;
      (map.get(status) ?? map.get(STANDARD_STATUS)!).push(p);
    }
    return map;
  }

  /**
   * Die Sparten in der Reihenfolge, in der sie stehen sollen – und am Ende
   * "Ohne Gruppe", falls dort etwas liegt.
   *
   * Ein Projekt ohne Sparte verschwindet nicht, es sammelt sich sichtbar
   * unten. Eine Gliederung, die Projekte unsichtbar macht, richtet mehr
   * Schaden an, als sie Ordnung bringt.
   */
  const echteSparten = gruppen;

  const nachSparte = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const g of gruppen) map.set(g.id, []);
    map.set(OHNE_SPARTE, []);
    for (const p of projects) {
      const schluessel = p.group_id && map.has(p.group_id) ? p.group_id : OHNE_SPARTE;
      map.get(schluessel)!.push(p);
    }
    return map;
  }, [projects, gruppen]);

  const sparten = useMemo(() => {
    // Gibt es gar keine Sparten, steht alles unter "Alle Projekte" – so sieht
    // die Seitenleiste vor Migration 0043 aus wie bisher.
    if (!gruppen.length) return [{ id: OHNE_SPARTE, name: 'Alle Projekte' }];

    /**
     * Leere Sparten sehen nur wir.
     *
     * Ein Lieferant, der nichts bei den Heizungen macht, soll die Ueberschrift
     * "Heizung" gar nicht erst sehen – sie sagt ihm nichts und verraet
     * nebenbei, woran wir sonst noch arbeiten. Fuer uns bleiben sie stehen:
     * Ohne sichtbare leere Sparte liesse sich kein Projekt hineinziehen, und
     * eine neu angelegte Gruppe waere im selben Moment wieder verschwunden.
     */
    const liste: Array<{ id: string; name: string }> = gruppen
      .filter((g) => isAdmin || (nachSparte.get(g.id) ?? []).length > 0)
      .map((g) => ({ id: g.id, name: g.name }));

    if ((nachSparte.get(OHNE_SPARTE) ?? []).length) {
      liste.push({ id: OHNE_SPARTE, name: 'Ohne Gruppe' });
    }
    return liste;
  }, [gruppen, nachSparte, isAdmin]);

  const laden = useCallback(async () => {
    try {
      const { gruppen: geladen } = await api<{ gruppen: ProjektGruppe[] }>('/api/groups');
      setGruppen(geladen ?? []);
    } catch {
      // Ohne Sparten bleibt es bei der bisherigen Gliederung nach Phase.
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void laden(), 0);
    return () => window.clearTimeout(t);
  }, [laden]);

  function klappen(schluessel: string, istZu: boolean) {
    setZu((current) => new Map(current).set(schluessel, !istZu));
  }

  function sparteKlappen(id: string) {
    setSparteZu((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), ort.trim());
      setName('');
      setOrt('');
      setShowForm(false);
    } catch (error) {
      reportError(error, 'Projekt konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ablegen: die gezogene Karte wird vor der Karte eingefügt, über der sie
   * losgelassen wurde – oder ans Ende der Gruppe, wenn auf die Überschrift.
   */
  async function ablegen(
    zielStatus: ProjektStatus,
    zielId: string | null,
    zielSparte: string,
  ) {
    const quelle = gezogen;
    setGezogen(null);
    setUeber(null);
    if (!quelle) return;

    const ohne = projects.filter((p) => p.id !== quelle);
    const bewegt = projects.find((p) => p.id === quelle);
    if (!bewegt) return;

    const neueGruppe = zielSparte === OHNE_SPARTE ? null : zielSparte;
    const neuesProjekt: Project = {
      ...bewegt,
      status: zielStatus,
      group_id: neueGruppe,
    };

    // Neue Gesamtliste in der Reihenfolge aufbauen, wie sie angezeigt wird:
    // erst nach Sparte, darin nach Phase.
    const sortiert: Project[] = [];
    const spartenFolge = [...gruppen.map((g) => g.id), OHNE_SPARTE];

    for (const sparte of spartenFolge) {
      for (const st of PROJEKT_STATUS) {
        const inGruppe = ohne.filter(
          (p) =>
            (p.group_id ?? OHNE_SPARTE) === sparte &&
            (p.status ?? STANDARD_STATUS) === st.wert,
        );
        if (sparte === zielSparte && st.wert === zielStatus) {
          const index = zielId ? inGruppe.findIndex((p) => p.id === zielId) : -1;
          if (index === -1) inGruppe.push(neuesProjekt);
          else inGruppe.splice(index, 0, neuesProjekt);
        }
        sortiert.push(...inGruppe);
      }
    }

    // Sofort umsortiert anzeigen, danach speichern.
    onReordered(sortiert);

    try {
      // Erst die Sparte, dann die Reihenfolge: Beides zusammen ginge nur ueber
      // eine eigene Route, und ein Projekt, das in der falschen Sparte landet,
      // faellt mehr auf als eine Reihenfolge, die einen Wimpernschlag spaeter
      // sitzt.
      if ((bewegt.group_id ?? null) !== neueGruppe) {
        await patch(`/api/projects/${quelle}`, { groupId: neueGruppe });
      }
      await post('/api/projects/reorder', {
        order: sortiert.map((p) => p.id),
        status: { [quelle]: zielStatus },
      });
    } catch (error) {
      reportError(error, 'Reihenfolge konnte nicht gespeichert werden.');
    }
  }

  /**
   * Die Phasen innerhalb einer Sparte.
   *
   * Derselbe Block wie frueher, nur nicht mehr einmal fuer alle Projekte,
   * sondern einmal je Sparte. Das Zuklappen wird deshalb je Sparte gemerkt:
   * Wer "Abgeschlossen" bei PVA zuklappt, will es bei BESS nicht auch zu
   * haben.
   */
  function phasenAnsicht(phasen: Map<ProjektStatus, Project[]>, sparteId: string) {
    return PROJEKT_STATUS.map((s) => {
      const inGruppe = phasen.get(s.wert) ?? [];
      const schluessel = `${sparteId}:${s.wert}`;
      const eingeklappt = istEingeklappt(schluessel, s.wert, inGruppe.length);

      // Eine leere Phase sieht nur, wer sie brauchen kann: Wir schieben dort
      // Projekte hinein, ein Lieferant nicht. Fuer ihn faellt sie ganz weg.
      if (!inGruppe.length && !isAdmin) return null;

          return (
            <div
              className={`projekt-gruppe ${!inGruppe.length ? 'leer' : ''}`}
              key={schluessel}
            >
              <button
                type="button"
                className="gruppe-kopf"
                onClick={() => klappen(schluessel, eingeklappt)}
                onDragOver={(e) => {
                  if (isAdmin && gezogen) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void ablegen(s.wert, null, sparteId);
                }}
                aria-expanded={!eingeklappt}
              >
                <span className={`gruppe-pfeil ${eingeklappt ? 'zu' : ''}`}>▾</span>
                {s.name}
                <span className="gruppe-anzahl">{inGruppe.length}</span>
              </button>

              {!eingeklappt && (
                <div className="gruppe-inhalt">
                  {inGruppe.map((p) => (
                    <div
                      key={p.id}
                      className={`project-item ${p.id === activeId ? 'active' : ''} ${
                        gezogen === p.id ? 'zieht' : ''
                      } ${ueber?.id === p.id ? 'ziel' : ''}`}
                      draggable={isAdmin}
                      onDragStart={() => setGezogen(p.id)}
                      onDragEnd={() => {
                        setGezogen(null);
                        setUeber(null);
                      }}
                      onDragOver={(e) => {
                        if (!isAdmin || !gezogen) return;
                        e.preventDefault();
                        setUeber({ id: p.id, status: s.wert });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void ablegen(s.wert, p.id, sparteId);
                      }}
                      onClick={() => waehlen(p.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') waehlen(p.id);
                      }}
                    >
                      {isAdmin && <span className="zieh-griff" title="Verschieben">⠿</span>}
                      <div className="dot" />
                      <div style={{ minWidth: 0 }}>
                        <div className="pname">{p.name}</div>
                        <div className="pmeta">{p.ort ?? ''}</div>
                      </div>
                    </div>
                  ))}

                  {!inGruppe.length && (
                    <div
                      className="gruppe-leer"
                      onDragOver={(e) => {
                        if (isAdmin && gezogen) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        void ablegen(s.wert, null, sparteId);
                      }}
                    >
                      {isAdmin ? 'Projekt hierher ziehen' : 'Keine Projekte'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
    });
  }


  // ------------------------------------------------------------- Sparten
  /**
   * Verschieben. Die ganze neue Abfolge geht an den Server und nicht "tausche
   * diese beiden": Bricht ein Tausch auf halbem Weg ab, haetten zwei Sparten
   * dieselbe Nummer und die Reihenfolge waere danach Zufall.
   */
  async function verschieben(id: string, richtung: -1 | 1) {
    const index = gruppen.findIndex((g) => g.id === id);
    const ziel = index + richtung;
    if (index < 0 || ziel < 0 || ziel >= gruppen.length) return;

    const neu = [...gruppen];
    [neu[index], neu[ziel]] = [neu[ziel], neu[index]];
    setGruppen(neu);

    try {
      await patch('/api/groups', { reihenfolge: neu.map((g) => g.id) });
    } catch (error) {
      reportError(error, 'Reihenfolge konnte nicht gespeichert werden.');
      await laden();
    }
  }

  async function gruppeAnlegen(name: string) {
    if (!name.trim()) return;
    setNeueGruppe(null);
    try {
      await post('/api/groups', { name: name.trim() });
      await laden();
    } catch (error) {
      reportError(error, 'Die Gruppe konnte nicht angelegt werden.');
    }
  }

  /** Den Entwurf speichern – leer oder unveraendert heisst: nichts tun. */
  async function umbenennenSpeichern(id: string, alterName: string) {
    const name = entwurf.trim();
    setBenennt(null);
    if (!name || name === alterName) return;

    try {
      await patch('/api/groups', { id, name });
      await laden();
    } catch (error) {
      reportError(error, 'Die Gruppe konnte nicht umbenannt werden.');
    }
  }

  /**
   * Eine Gruppe entfernen. Die Projekte darin bleiben und rutschen unter
   * "Ohne Gruppe" – das sagt die Rueckfrage auch ausdruecklich, damit niemand
   * denkt, er loesche gerade seine Projekte.
   */
  function gruppeEntfernen(sp: { id: string; name: string }) {
    const drin = (nachSparte.get(sp.id) ?? []).length;
    const text = drin
      ? `Gruppe „${sp.name}" entfernen?\n\nDie ${drin} Projekte darin bleiben bestehen und stehen danach unter „Ohne Gruppe" – sie werden NICHT gelöscht.`
      : `Gruppe „${sp.name}" entfernen?`;

    confirm(
      text,
      async () => {
        try {
          await del('/api/groups', { id: sp.id });
          await laden();
        } catch (error) {
          reportError(error, 'Die Gruppe konnte nicht entfernt werden.');
        }
      },
      'Entfernen',
    );
  }

  /** Auf dem Handy nach der Wahl zuklappen – der Inhalt soll sofort dastehen. */
  function waehlen(id: string) {
    setListeOffen(false);
    onSelect(id);
  }

  return (
    <div className={`sidebar ${listeOffen ? '' : 'liste-zu'}`}>
      {/* Steht bewusst über den Projekten: der Einstieg in den Arbeitstag. */}
      <button
        type="button"
        className={`woche-knopf ${wocheAktiv ? 'aktiv' : ''}`}
        onClick={() => {
          setListeOffen(false);
          onWoche();
        }}
      >
        <span aria-hidden="true">🗓️</span> Meine To-Do&rsquo;s
      </button>

      <h2>Projekte</h2>

      {/* Nur auf dem Handy sichtbar: zeigt, wo man ist, und klappt die Liste
          auf. Am Rechner blendet die Gestaltung diesen Knopf aus. */}
      <button
        type="button"
        className="projekt-waehler"
        onClick={() => setListeOffen((o) => !o)}
        aria-expanded={listeOffen}
      >
        <span className="waehler-text">
          {aktivesProjekt ? (
            <>
              <span className="waehler-name">{aktivesProjekt.name}</span>
              {aktivesProjekt.ort && (
                <span className="waehler-ort">{aktivesProjekt.ort}</span>
              )}
            </>
          ) : (
            <span className="waehler-name">Projekt wählen</span>
          )}
        </span>
        <span className={`gruppe-pfeil ${listeOffen ? '' : 'zu'}`}>▾</span>
      </button>

      <div className={`project-list ${listeOffen ? '' : 'zu'}`}>
        {sparten.map((sp) => {
          const drin = nachSparte.get(sp.id) ?? [];
          const zuS = sparteZu.has(sp.id);

          return (
            <div className="sparte" key={sp.id}>
              <div className="sparte-kopf">
                {benennt === sp.id ? (
                  <input
                    className="sparte-eingabe"
                    value={entwurf}
                    autoFocus
                    onChange={(e) => setEntwurf(e.target.value)}
                    onBlur={() => void umbenennenSpeichern(sp.id, sp.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void umbenennenSpeichern(sp.id, sp.name);
                      if (e.key === 'Escape') setBenennt(null);
                    }}
                    aria-label="Name der Gruppe"
                  />
                ) : (
                  <button
                    type="button"
                    className="sparte-titel"
                    onClick={() => sparteKlappen(sp.id)}
                    aria-expanded={!zuS}
                  >
                    <span className={`gruppe-pfeil ${zuS ? 'zu' : ''}`}>▾</span>
                    {sp.name}
                    <span className="gruppe-anzahl">{drin.length}</span>
                  </button>
                )}
                {isAdmin && sp.id !== OHNE_SPARTE && (
                  <span className="sparte-werkzeuge">
                    <button
                      type="button"
                      className="icon-btn"
                      title="Nach oben"
                      onClick={() => void verschieben(sp.id, -1)}
                      disabled={sparten[0]?.id === sp.id}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Nach unten"
                      onClick={() => void verschieben(sp.id, 1)}
                      disabled={echteSparten[echteSparten.length - 1]?.id === sp.id}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Umbenennen"
                      onClick={() => {
                        setEntwurf(sp.name);
                        setBenennt(sp.id);
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Gruppe entfernen"
                      onClick={() => gruppeEntfernen(sp)}
                    >
                      🗑️
                    </button>
                  </span>
                )}
              </div>

              {!zuS && (
                <div className="sparte-inhalt">
                  {phasenAnsicht(phasenVon(drin), sp.id)}
                </div>
              )}
            </div>
          );
        })}

        {isAdmin &&
          (neueGruppe === null ? (
            <button type="button" className="sparte-neu" onClick={() => setNeueGruppe('')}>
              + Gruppe
            </button>
          ) : (
            <input
              className="sparte-eingabe"
              value={neueGruppe}
              autoFocus
              placeholder="Name der Gruppe, z.B. Wärmepumpen"
              onChange={(e) => setNeueGruppe(e.target.value)}
              onBlur={() => void gruppeAnlegen(neueGruppe)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void gruppeAnlegen(neueGruppe);
                if (e.key === 'Escape') setNeueGruppe(null);
              }}
              aria-label="Name der neuen Gruppe"
            />
          ))}
      </div>

      {isAdmin &&
        (!showForm ? (
          <button
            type="button"
            className="new-project-btn"
            onClick={() => setShowForm(true)}
          >
            + Neues Projekt
          </button>
        ) : (
          <div className="new-project-form">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="Projektname, z.B. Tägerwilen"
              autoFocus
            />
            <input
              type="text"
              value={ort}
              onChange={(e) => setOrt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              placeholder="Ort / Adresse (optional)"
            />
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={submit}
                disabled={busy}
              >
                {busy ? 'Einen Moment…' : 'Anlegen'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowForm(false)}
                disabled={busy}
              >
                Abbrechen
              </button>
            </div>
          </div>
        ))}

      {!isAdmin && !projects.length && (
        <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 4px' }}>
          Dir wurde noch kein Projekt zugewiesen.
        </p>
      )}

      {/* Bewusst klein und ganz unten: interessiert selten, soll aber auffindbar
          sein, ohne dafür ins Supabase-Dashboard zu müssen. */}
      {/* Der Papierkorb gilt für alle Projekte – vorher hing er am einzelnen
          Projekt, und man musste raten, wo etwas gelandet war. */}
      {isAdmin && (
        <div className="fuss-links">
          <button type="button" className="speicher-link" onClick={onPapierkorb}>
            Papierkorb
          </button>
          <button type="button" className="speicher-link" onClick={onKontakte}>
            Kontakte
          </button>
          <button type="button" className="speicher-link" onClick={onNachrichten}>
            Nachrichten
          </button>
        </div>
      )}
    </div>
  );
}
