'use client';

import { useMemo, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { post } from '@/lib/client/api';
import { PROJEKT_STATUS, type Project, type ProjektStatus } from '@/types';

const STANDARD_STATUS: ProjektStatus = 'umsetzung';

export default function Sidebar({
  projects,
  activeId,
  isAdmin,
  wocheAktiv,
  onWoche,
  onSelect,
  onCreate,
  onReordered,
  onSpeicher,
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
  /** Öffnet die Speicherübersicht – nur für uns sichtbar. */
  onSpeicher: () => void;
}) {
  const { reportError } = useFeedback();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [ort, setOrt] = useState('');
  const [busy, setBusy] = useState(false);

  // Abgeschlossene Projekte sind standardmässig eingeklappt – sie stehen
  // im Alltag nur im Weg.
  const [zu, setZu] = useState<Set<ProjektStatus>>(new Set(['abgeschlossen']));

  const [gezogen, setGezogen] = useState<string | null>(null);
  const [ueber, setUeber] = useState<{ id: string; status: ProjektStatus } | null>(null);

  const gruppiert = useMemo(() => {
    const map = new Map<ProjektStatus, Project[]>();
    for (const s of PROJEKT_STATUS) map.set(s.wert, []);
    for (const p of projects) {
      const status = (p.status ?? STANDARD_STATUS) as ProjektStatus;
      (map.get(status) ?? map.get(STANDARD_STATUS)!).push(p);
    }
    return map;
  }, [projects]);

  function klappen(status: ProjektStatus) {
    setZu((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
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
  async function ablegen(zielStatus: ProjektStatus, zielId: string | null) {
    const quelle = gezogen;
    setGezogen(null);
    setUeber(null);
    if (!quelle) return;

    const ohne = projects.filter((p) => p.id !== quelle);
    const bewegt = projects.find((p) => p.id === quelle);
    if (!bewegt) return;

    const neuesProjekt: Project = { ...bewegt, status: zielStatus };

    // Neue Gesamtliste in der Reihenfolge aufbauen, wie sie angezeigt wird.
    const sortiert: Project[] = [];
    for (const s of PROJEKT_STATUS) {
      const inGruppe = ohne.filter(
        (p) => (p.status ?? STANDARD_STATUS) === s.wert,
      );
      if (s.wert === zielStatus) {
        const index = zielId ? inGruppe.findIndex((p) => p.id === zielId) : -1;
        if (index === -1) inGruppe.push(neuesProjekt);
        else inGruppe.splice(index, 0, neuesProjekt);
      }
      sortiert.push(...inGruppe);
    }

    // Sofort umsortiert anzeigen, danach speichern.
    onReordered(sortiert);

    try {
      await post('/api/projects/reorder', {
        order: sortiert.map((p) => p.id),
        status: { [quelle]: zielStatus },
      });
    } catch (error) {
      reportError(error, 'Reihenfolge konnte nicht gespeichert werden.');
    }
  }

  return (
    <div className="sidebar">
      {/* Steht bewusst über den Projekten: der Einstieg in den Arbeitstag. */}
      <button
        type="button"
        className={`woche-knopf ${wocheAktiv ? 'aktiv' : ''}`}
        onClick={onWoche}
      >
        <span aria-hidden="true">🗓️</span> Meine To-Do&rsquo;s
      </button>

      <h2>Projekte</h2>

      <div className="project-list">
        {PROJEKT_STATUS.map((s) => {
          const inGruppe = gruppiert.get(s.wert) ?? [];
          const eingeklappt = zu.has(s.wert);

          return (
            <div className="projekt-gruppe" key={s.wert}>
              <button
                type="button"
                className="gruppe-kopf"
                onClick={() => klappen(s.wert)}
                onDragOver={(e) => {
                  if (isAdmin && gezogen) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void ablegen(s.wert, null);
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
                        void ablegen(s.wert, p.id);
                      }}
                      onClick={() => onSelect(p.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') onSelect(p.id);
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
                        void ablegen(s.wert, null);
                      }}
                    >
                      {isAdmin ? 'Projekt hierher ziehen' : 'Keine Projekte'}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
      {isAdmin && (
        <button type="button" className="speicher-link" onClick={onSpeicher}>
          Speicherplatz
        </button>
      )}
    </div>
  );
}
