'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { heute } from '@/lib/due';
import {
  kalenderwoche,
  PLAN_FARBEN,
  schriftfarbeAuf,
  tagPlus,
  tageZwischen,
} from '@/lib/schedule';
import Avatar from '@/components/Avatar';
import { assigneePerson } from '@/lib/people';
import { adminAssignee, supplierAssignee } from '@/lib/assignee';
import { fmtDate, supplierLabel } from '@/lib/format';
import { fmtDueDate } from '@/lib/due';
import { findPerson } from '@/lib/people';
import type { ProjectDetail, ScheduleTask, SessionInfo } from '@/types';

/** Breite einer Tagesspalte in Pixel. */
const TAG_BREITE = 30;

type Entwurf = {
  responsible: string;
  owner: string;
  label: string;
  startDate: string;
  endDate: string;
  color: string;
};

/** Was beim Klick in eine bestehende Zeile übernommen wird. */
type Vorlage = Pick<Entwurf, 'responsible' | 'owner' | 'color'>;

const leerVorlage: Vorlage = {
  responsible: '',
  owner: '',
  color: PLAN_FARBEN[0].wert,
};

const leererEntwurf = (start: string): Entwurf => ({
  ...leerVorlage,
  label: '',
  startDate: start,
  endDate: start,
});

export default function ScheduleTab({
  detail,
  session,
  isAdmin,
  reload,
}: {
  detail: ProjectDetail;
  session: SessionInfo;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>(leererEntwurf(heute()));
  const [neu, setNeu] = useState<Entwurf>(leererEntwurf(heute()));

  // Ziehen im Raster, um einen Zeitraum zu wählen.
  const [auswahl, setAuswahl] = useState<{
    zeile: string;
    vonIdx: number;
    bisIdx: number;
  } | null>(null);
  // Bewusst Zustand statt Referenzen: die Zellen werden beim Zeichnen erzeugt und
  // dürfen dabei keine Referenz anfassen.
  const [notizTaskId, setNotizTaskId] = useState<string | null>(null);
  const [notizText, setNotizText] = useState('');
  const [notizVon, setNotizVon] = useState('');
  const [notizBis, setNotizBis] = useState('');
  const [zieht, setZieht] = useState(false);
  const [vorlage, setVorlage] = useState<Vorlage>(leerVorlage);
  const labelRef = useRef<HTMLInputElement>(null);

  const projectId = detail.project.id;
  const plan = detail.schedule;

  /**
   * Zeitraum der Darstellung. Ist er nicht gesetzt, spannt er sich über die
   * erfassten Arbeiten – so sieht man auch ohne Eingabe sofort etwas.
   */
  const { von, bis, tage } = useMemo(() => {
    const starts = plan.map((t) => t.start_date);
    const enden = plan.map((t) => t.end_date);

    const anfang =
      detail.project.schedule_start ??
      (starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : heute());

    const ende =
      detail.project.schedule_end ??
      (enden.length ? enden.reduce((a, b) => (a > b ? a : b)) : tagPlus(heute(), 30));

    const spanne = Math.max(1, Math.min(tageZwischen(anfang, ende), 730));
    return { von: anfang, bis: ende, tage: spanne };
  }, [detail.project.schedule_start, detail.project.schedule_end, plan]);

  const tagesListe = useMemo(
    () => Array.from({ length: tage }, (_, i) => tagPlus(von, i)),
    [von, tage],
  );

  const heuteStr = heute();

  /** Wer als Organisator in Frage kommt. */
  const personen = useMemo(
    () => [
      ...detail.admins.map((a) => ({
        wert: adminAssignee(a.user_id),
        name: a.name,
        gruppe: 'Swiss Solar Ventures AG',
      })),
      ...detail.suppliers.map((s) => ({
        wert: supplierAssignee(s.id),
        name: supplierLabel(s),
        gruppe: 'Lieferanten',
      })),
    ],
    [detail.admins, detail.suppliers],
  );

  // Loslassen auch ausserhalb des Rasters beenden lassen, sonst bliebe die
  // Auswahl kleben, wenn die Maus die Karte verlässt.
  useEffect(() => {
    if (!zieht) return;

    function beiLoslassen() {
      setZieht(false);
      setAuswahl((aktuell) => {
        if (aktuell) {
          const a = Math.min(aktuell.vonIdx, aktuell.bisIdx);
          const b = Math.max(aktuell.vonIdx, aktuell.bisIdx);
          setNeu({
            ...vorlage,
            label: '',
            startDate: tagesListe[a],
            endDate: tagesListe[b],
          });
          setEditingId(null);
          // Der Fokus springt ins Textfeld, damit man sofort tippen kann.
          setTimeout(() => labelRef.current?.focus(), 0);
        }
        return null;
      });
    }

    window.addEventListener('pointerup', beiLoslassen);
    return () => window.removeEventListener('pointerup', beiLoslassen);
  }, [zieht, vorlage, tagesListe]);

  async function run(action: () => Promise<void>, fallback: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      reportError(error, fallback);
    } finally {
      setBusy(false);
    }
  }

  const zeitraumAendern = (feld: 'scheduleStart' | 'scheduleEnd', wert: string) =>
    run(async () => {
      await patch(`/api/projects/${projectId}`, { [feld]: wert || null });
      await reload();
    }, 'Zeitraum konnte nicht gespeichert werden.');

  const anlegen = () =>
    run(async () => {
      if (!neu.label.trim()) throw new Error('Bitte die Arbeit benennen.');
      await post(`/api/projects/${projectId}/schedule`, neu);
      setNeu(leererEntwurf(neu.endDate || heuteStr));
      await reload();
      toast('✓ Eintrag angelegt.');
    }, 'Eintrag konnte nicht angelegt werden.');

  const speichern = (id: string) =>
    run(async () => {
      if (!entwurf.label.trim()) throw new Error('Bitte die Arbeit benennen.');
      await patch(`/api/schedule/${id}`, entwurf);
      setEditingId(null);
      await reload();
      toast('✓ Eintrag gespeichert.');
    }, 'Speichern fehlgeschlagen.');

  function loeschen(task: ScheduleTask) {
    confirm(`„${task.label}“ aus dem Terminplan entfernen?`, async () => {
      await del(`/api/schedule/${task.id}`);
      await reload();
      toast('🗑️ Eintrag entfernt.');
    });
  }

  const notizSenden = (task: ScheduleTask) =>
    run(async () => {
      if (!notizText.trim()) throw new Error('Bitte eine Anmerkung schreiben.');
      if ((notizVon && !notizBis) || (!notizVon && notizBis)) {
        throw new Error('Für einen Vorschlag bitte Beginn und Ende angeben.');
      }
      await post(`/api/schedule/${task.id}/notes`, {
        text: notizText.trim(),
        vorschlagStart: notizVon || null,
        vorschlagEnde: notizBis || null,
      });
      setNotizText('');
      setNotizVon('');
      setNotizBis('');
      await reload();
      toast(notizVon ? '✓ Vorschlag gesendet.' : '✓ Anmerkung gesendet.');
    }, 'Anmerkung konnte nicht gesendet werden.');

  const entscheiden = (notizId: string, entscheidung: 'uebernehmen' | 'ablehnen') =>
    run(async () => {
      await patch(`/api/schedule/notes/${notizId}`, { entscheidung });
      await reload();
      toast(entscheidung === 'uebernehmen' ? '✓ Termin übernommen.' : 'Vorschlag abgelehnt.');
    }, 'Entscheidung konnte nicht gespeichert werden.');

  const notizLoeschen = (notizId: string) =>
    run(async () => {
      await del(`/api/schedule/notes/${notizId}`);
      await reload();
    }, 'Anmerkung konnte nicht entfernt werden.');

  function bearbeiten(task: ScheduleTask) {
    setEditingId(task.id);
    setEntwurf({
      responsible: task.responsible ?? '',
      owner: task.owner ?? '',
      label: task.label,
      startDate: task.start_date,
      endDate: task.end_date,
      color: task.color,
    });
  }

  function beginneAuswahl(zeile: string, idx: number, neueVorlage: Vorlage) {
    if (!isAdmin) return;
    setZieht(true);
    setVorlage(neueVorlage);
    setAuswahl({ zeile, vonIdx: idx, bisIdx: idx });
  }

  function erweitereAuswahl(zeile: string, idx: number) {
    if (!zieht) return;
    setAuswahl((a) => (a && a.zeile === zeile ? { ...a, bisIdx: idx } : a));
  }

  /** Monatsbeschriftungen über dem Tagesraster. */
  const monate = useMemo(() => {
    const gruppen: Array<{ name: string; anzahl: number }> = [];
    for (const tag of tagesListe) {
      const name = new Date(`${tag}T00:00:00`).toLocaleDateString('de-CH', {
        month: 'long',
        year: 'numeric',
      });
      const letzte = gruppen[gruppen.length - 1];
      if (letzte && letzte.name === name) letzte.anzahl += 1;
      else gruppen.push({ name, anzahl: 1 });
    }
    return gruppen;
  }, [tagesListe]);

  /** Kalenderwochen als eigene Zeile über den Tagen. */
  const wochen = useMemo(() => {
    const gruppen: Array<{ kw: number; anzahl: number }> = [];
    for (const tag of tagesListe) {
      const kw = kalenderwoche(tag);
      const letzte = gruppen[gruppen.length - 1];
      if (letzte && letzte.kw === kw) letzte.anzahl += 1;
      else gruppen.push({ kw, anzahl: 1 });
    }
    return gruppen;
  }, [tagesListe]);

  const rasterBreite = tage * TAG_BREITE;

  function istWochenende(tag: string): boolean {
    const wt = new Date(`${tag}T00:00:00`).getDay();
    return wt === 0 || wt === 6;
  }

  /** Die Tageszellen einer Zeile, mit Auswahl-Vorschau. */
  function zellen(zeile: string, zellenVorlage: Vorlage) {
    const aktiv = auswahl?.zeile === zeile ? auswahl : null;
    const a = aktiv ? Math.min(aktiv.vonIdx, aktiv.bisIdx) : -1;
    const b = aktiv ? Math.max(aktiv.vonIdx, aktiv.bisIdx) : -2;

    return tagesListe.map((tag, i) => (
      <div
        key={tag}
        className={`plan-zelle ${istWochenende(tag) ? 'wochenende' : ''} ${
          tag === heuteStr ? 'heute' : ''
        } ${i >= a && i <= b ? 'gewaehlt' : ''} ${isAdmin ? 'klickbar' : ''}`}
        onPointerDown={() => beginneAuswahl(zeile, i, zellenVorlage)}
        onPointerEnter={() => erweitereAuswahl(zeile, i)}
        title={isAdmin ? 'Ziehen, um einen Zeitraum zu wählen' : undefined}
      />
    ));
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>Terminplan</h2>
      </div>

      <div className="plan-zeitraum">
        <label>
          Von
          <input
            type="date"
            value={detail.project.schedule_start ?? ''}
            onChange={(e) => zeitraumAendern('scheduleStart', e.target.value)}
            disabled={!isAdmin || busy}
          />
        </label>
        <label>
          Bis
          <input
            type="date"
            value={detail.project.schedule_end ?? ''}
            onChange={(e) => zeitraumAendern('scheduleEnd', e.target.value)}
            disabled={!isAdmin || busy}
          />
        </label>
        {isAdmin && (
          <span className="plan-hinweis">
            Im Raster über die Tage ziehen, um eine Arbeit anzulegen.
          </span>
        )}
      </div>

      <div className="plan-scroll">
        <div
          className="plan-raster"
          style={{ ['--tag-breite' as string]: `${TAG_BREITE}px` }}
        >
          <div className="plan-kopf-links">Wer / Gewerk / Arbeit</div>
          <div className="plan-kopf-rechts" style={{ width: rasterBreite }}>
            <div className="plan-monate">
              {monate.map((m, i) => (
                <div
                  key={`${m.name}-${i}`}
                  className="plan-monat"
                  style={{ width: m.anzahl * TAG_BREITE }}
                >
                  {m.name}
                </div>
              ))}
            </div>
            <div className="plan-monate">
              {wochen.map((w, i) => (
                <div
                  key={`${w.kw}-${i}`}
                  className="plan-kw"
                  style={{ width: w.anzahl * TAG_BREITE }}
                  title={`Kalenderwoche ${w.kw}`}
                >
                  KW {w.kw}
                </div>
              ))}
            </div>
            <div className="plan-tage">
              {tagesListe.map((tag) => (
                <div
                  key={tag}
                  className={`plan-tag ${istWochenende(tag) ? 'wochenende' : ''} ${
                    tag === heuteStr ? 'heute' : ''
                  }`}
                  title={new Date(`${tag}T00:00:00`).toLocaleDateString('de-CH')}
                >
                  {tag.slice(8)}
                </div>
              ))}
            </div>
          </div>

          {plan.map((task) => {
            const startVersatz = Math.max(0, tageZwischen(von, task.start_date) - 1);
            const laenge = Math.max(
              1,
              tageZwischen(
                task.start_date < von ? von : task.start_date,
                task.end_date > bis ? bis : task.end_date,
              ),
            );
            const sichtbar = task.end_date >= von && task.start_date <= bis;
            const person = assigneePerson(detail, task.owner);
            const zeilenVorlage: Vorlage = {
              responsible: task.responsible ?? '',
              owner: task.owner ?? '',
              color: task.color,
            };

            return (
              <div className="plan-zeile" key={task.id}>
                <div className="plan-links">
                  {task.owner ? (
                    <div className="plan-person" title={`Organisiert von ${person.name}`}>
                      <Avatar url={person.avatarUrl} name={person.name} size={30} />
                    </div>
                  ) : (
                    <div className="plan-person plan-person-leer" />
                  )}
                  <div className="plan-links-text">
                    <div className="plan-verantwortlich">{task.responsible || '—'}</div>
                    <div className="plan-arbeit">{task.label}</div>
                    {task.notes.length > 0 && (
                      <button
                        type="button"
                        className="plan-notiz-marke"
                        onClick={() =>
                          setNotizTaskId((a) => (a === task.id ? null : task.id))
                        }
                      >
                        💬 {task.notes.length}
                        {task.notes.some((n) => n.status === 'offen') && ' offen'}
                      </button>
                    )}
                  </div>
                  {isAdmin && (
                    <div className="plan-links-aktionen">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Bearbeiten"
                        onClick={() => bearbeiten(task)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Entfernen"
                        onClick={() => loeschen(task)}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
                <div className="plan-rechts" style={{ width: rasterBreite }}>
                  {zellen(task.id, zeilenVorlage)}
                  {sichtbar && (
                    <div
                      className="plan-balken"
                      style={{
                        left: startVersatz * TAG_BREITE,
                        width: laenge * TAG_BREITE - 4,
                        background: task.color,
                        color: schriftfarbeAuf(task.color),
                      }}
                      title={`${task.label} · ${task.start_date} bis ${task.end_date}`}
                      onClick={() =>
                        setNotizTaskId((aktuell) =>
                          aktuell === task.id ? null : task.id,
                        )
                      }
                    >
                      {task.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Leere Zeile zum Anlegen: hier zieht man einen neuen Zeitraum auf. */}
          {isAdmin && (
            <div className="plan-zeile plan-zeile-neu">
              <div className="plan-links">
                <div className="plan-person plan-person-leer" />
                <div className="plan-links-text">
                  <div className="plan-arbeit" style={{ color: 'var(--ink-faint)' }}>
                    + Arbeit aufziehen
                  </div>
                </div>
              </div>
              <div className="plan-rechts" style={{ width: rasterBreite }}>
                {zellen('neu', leerVorlage)}
              </div>
            </div>
          )}

          {!plan.length && !isAdmin && (
            <div className="plan-zeile">
              <div className="plan-links" style={{ color: 'var(--ink-faint)' }}>
                Noch keine Arbeiten erfasst.
              </div>
              <div className="plan-rechts" style={{ width: rasterBreite }} />
            </div>
          )}
        </div>
      </div>


      {/* Rückmeldungen zur gewählten Arbeit */}
      {(() => {
        const gewaehlt = plan.find((t) => t.id === notizTaskId);
        if (!gewaehlt) return null;

        return (
          <div className="notiz-karte">
            <div className="notiz-kopf">
              <div>
                <div className="plan-verantwortlich">{gewaehlt.responsible || '—'}</div>
                <strong>{gewaehlt.label}</strong>
                <span className="notiz-zeitraum">
                  {fmtDueDate(gewaehlt.start_date)} – {fmtDueDate(gewaehlt.end_date)}
                </span>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setNotizTaskId(null)}
                title="Schliessen"
              >
                ✕
              </button>
            </div>

            {gewaehlt.notes.length ? (
              gewaehlt.notes.map((n) => {
                const person = findPerson(detail, {
                  name: n.author,
                  supplierId: n.author_supplier_id,
                });
                const eigen =
                  session.kind === 'supplier'
                    ? n.author_supplier_id === session.supplierId
                    : n.author_supplier_id === null;

                return (
                  <div key={n.id} className="notiz-zeile">
                    <Avatar url={person.avatarUrl} name={person.name} size={26} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="notiz-text">{n.text}</div>
                      {n.vorschlag_start && n.vorschlag_ende && (
                        <div className={`notiz-vorschlag ${n.status}`}>
                          📅 Vorschlag: {fmtDueDate(n.vorschlag_start)} –{' '}
                          {fmtDueDate(n.vorschlag_ende)}
                          {n.status === 'uebernommen' && ' · übernommen'}
                          {n.status === 'abgelehnt' && ' · abgelehnt'}
                        </div>
                      )}
                      <div className="notiz-meta">
                        {n.author} · {fmtDate(n.created_at)}
                        {(eigen || isAdmin) && (
                          <button type="button" onClick={() => notizLoeschen(n.id)}>
                            entfernen
                          </button>
                        )}
                      </div>
                    </div>
                    {isAdmin && n.status === 'offen' && n.vorschlag_start && (
                      <div className="notiz-aktionen">
                        <button
                          type="button"
                          className="btn btn-accent btn-sm"
                          onClick={() => entscheiden(n.id, 'uebernehmen')}
                          disabled={busy}
                        >
                          Übernehmen
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => entscheiden(n.id, 'ablehnen')}
                          disabled={busy}
                        >
                          Ablehnen
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', margin: '6px 0' }}>
                Noch keine Rückmeldungen zu dieser Arbeit.
              </p>
            )}

            <div className="notiz-form">
              <input
                type="text"
                value={notizText}
                onChange={(e) => setNotizText(e.target.value)}
                placeholder="Anmerkung, z.B. „Gerüst steht erst am Mittwoch“"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') notizSenden(gewaehlt);
                }}
              />
              <div className="notiz-form-zeile">
                <span className="notiz-form-titel">Anderen Zeitraum vorschlagen</span>
                <input
                  type="date"
                  value={notizVon}
                  onChange={(e) => setNotizVon(e.target.value)}
                  aria-label="Vorschlag Beginn"
                />
                <input
                  type="date"
                  value={notizBis}
                  onChange={(e) => setNotizBis(e.target.value)}
                  aria-label="Vorschlag Ende"
                />
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={() => notizSenden(gewaehlt)}
                  disabled={busy}
                >
                  Senden
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {isAdmin && editingId && (
        <div className="plan-form">
          <div className="plan-form-titel">Eintrag bearbeiten</div>
          <Formular
            wert={entwurf}
            setzen={setEntwurf}
            personen={personen}
            absenden={() => speichern(editingId)}
            abbrechen={() => setEditingId(null)}
            busy={busy}
            knopf="Speichern"
          />
        </div>
      )}

      {isAdmin && !editingId && (
        <div className="plan-form">
          <div className="plan-form-titel">Arbeit hinzufügen</div>
          <Formular
            wert={neu}
            setzen={setNeu}
            personen={personen}
            absenden={anlegen}
            busy={busy}
            knopf="+ Hinzufügen"
            labelRef={labelRef}
          />
        </div>
      )}
    </div>
  );
}

function Formular({
  wert,
  setzen,
  personen,
  absenden,
  abbrechen,
  busy,
  knopf,
  labelRef,
}: {
  wert: Entwurf;
  setzen: (e: Entwurf) => void;
  personen: Array<{ wert: string; name: string; gruppe: string }>;
  absenden: () => void;
  abbrechen?: () => void;
  busy: boolean;
  knopf: string;
  labelRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const gruppen = Array.from(new Set(personen.map((p) => p.gruppe)));

  return (
    <div className="plan-form-felder">
      <select
        value={wert.owner}
        onChange={(e) => setzen({ ...wert, owner: e.target.value })}
        aria-label="Organisiert von"
        title="Organisiert von"
      >
        <option value="">Organisiert von …</option>
        {gruppen.map((g) => (
          <optgroup key={g} label={g}>
            {personen
              .filter((p) => p.gruppe === g)
              .map((p) => (
                <option key={p.wert} value={p.wert}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      <input
        type="text"
        value={wert.responsible}
        onChange={(e) => setzen({ ...wert, responsible: e.target.value })}
        placeholder="Gewerk (z.B. Gärtner)"
      />
      <input
        ref={labelRef}
        type="text"
        value={wert.label}
        onChange={(e) => setzen({ ...wert, label: e.target.value })}
        placeholder="Arbeit (z.B. Grabarbeiten)"
        onKeyDown={(e) => {
          if (e.key === 'Enter') absenden();
        }}
      />
      <input
        type="date"
        value={wert.startDate}
        onChange={(e) => setzen({ ...wert, startDate: e.target.value })}
        aria-label="Beginn"
      />
      <input
        type="date"
        value={wert.endDate}
        onChange={(e) => setzen({ ...wert, endDate: e.target.value })}
        aria-label="Ende"
      />
      <div className="plan-farben">
        {PLAN_FARBEN.map((f) => (
          <button
            key={f.wert}
            type="button"
            className={`plan-farbe ${wert.color === f.wert ? 'gewaehlt' : ''}`}
            style={{ background: f.wert }}
            title={f.name}
            aria-label={f.name}
            onClick={() => setzen({ ...wert, color: f.wert })}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={absenden}
          disabled={busy}
        >
          {knopf}
        </button>
        {abbrechen && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={abbrechen}
            disabled={busy}
          >
            Abbrechen
          </button>
        )}
      </div>
    </div>
  );
}
