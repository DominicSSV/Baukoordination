'use client';

import { useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { heute } from '@/lib/due';
import {
  PLAN_FARBEN,
  schriftfarbeAuf,
  tagPlus,
  tageZwischen,
} from '@/lib/schedule';
import type { ProjectDetail, ScheduleTask } from '@/types';

/** Breite einer Tagesspalte in Pixel. */
const TAG_BREITE = 30;

type Entwurf = {
  responsible: string;
  label: string;
  startDate: string;
  endDate: string;
  color: string;
};

const leererEntwurf = (start: string): Entwurf => ({
  responsible: '',
  label: '',
  startDate: start,
  endDate: start,
  color: PLAN_FARBEN[0].wert,
});

export default function ScheduleTab({
  detail,
  isAdmin,
  reload,
}: {
  detail: ProjectDetail;
  isAdmin: boolean;
  reload: () => Promise<void>;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState<Entwurf>(leererEntwurf(heute()));
  const [neu, setNeu] = useState<Entwurf>(leererEntwurf(heute()));

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

  function bearbeiten(task: ScheduleTask) {
    setEditingId(task.id);
    setEntwurf({
      responsible: task.responsible ?? '',
      label: task.label,
      startDate: task.start_date,
      endDate: task.end_date,
      color: task.color,
    });
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

  const rasterBreite = tage * TAG_BREITE;

  function istWochenende(tag: string): boolean {
    const wt = new Date(`${tag}T00:00:00`).getDay();
    return wt === 0 || wt === 6;
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>Terminplan</h2>
      </div>

      {/* Zeitraum des Plans */}
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
        {!detail.project.schedule_start && !detail.project.schedule_end && (
          <span className="plan-hinweis">
            Ohne Angabe spannt sich der Plan über die erfassten Arbeiten.
          </span>
        )}
      </div>

      {/* Balkenplan */}
      <div className="plan-scroll">
        <div className="plan-raster" style={{ ['--tage' as string]: tage, ['--tag-breite' as string]: `${TAG_BREITE}px` }}>
          {/* Kopf: Monate */}
          <div className="plan-kopf-links">Zuständig / Arbeit</div>
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

          {/* Zeilen */}
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

            return (
              <div className="plan-zeile" key={task.id}>
                <div className="plan-links">
                  <div className="plan-verantwortlich">{task.responsible || '—'}</div>
                  <div className="plan-arbeit">{task.label}</div>
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
                  {tagesListe.map((tag) => (
                    <div
                      key={tag}
                      className={`plan-zelle ${istWochenende(tag) ? 'wochenende' : ''} ${
                        tag === heuteStr ? 'heute' : ''
                      }`}
                    />
                  ))}
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
                    >
                      {task.label}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!plan.length && (
            <div className="plan-zeile">
              <div className="plan-links" style={{ color: 'var(--ink-faint)' }}>
                Noch keine Arbeiten erfasst.
              </div>
              <div className="plan-rechts" style={{ width: rasterBreite }}>
                {tagesListe.map((tag) => (
                  <div
                    key={tag}
                    className={`plan-zelle ${istWochenende(tag) ? 'wochenende' : ''} ${
                      tag === heuteStr ? 'heute' : ''
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bearbeiten */}
      {isAdmin && editingId && (
        <div className="plan-form">
          <div className="plan-form-titel">Eintrag bearbeiten</div>
          <Formular
            wert={entwurf}
            setzen={setEntwurf}
            absenden={() => speichern(editingId)}
            abbrechen={() => setEditingId(null)}
            busy={busy}
            knopf="Speichern"
          />
        </div>
      )}

      {/* Neu anlegen */}
      {isAdmin && !editingId && (
        <div className="plan-form">
          <div className="plan-form-titel">Arbeit hinzufügen</div>
          <Formular
            wert={neu}
            setzen={setNeu}
            absenden={anlegen}
            busy={busy}
            knopf="+ Hinzufügen"
          />
        </div>
      )}
    </div>
  );
}

function Formular({
  wert,
  setzen,
  absenden,
  abbrechen,
  busy,
  knopf,
}: {
  wert: Entwurf;
  setzen: (e: Entwurf) => void;
  absenden: () => void;
  abbrechen?: () => void;
  busy: boolean;
  knopf: string;
}) {
  return (
    <div className="plan-form-felder">
      <input
        type="text"
        value={wert.responsible}
        onChange={(e) => setzen({ ...wert, responsible: e.target.value })}
        placeholder="Zuständig (z.B. Gärtner)"
      />
      <input
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
