'use client';

import { useEffect, useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { patch, post } from '@/lib/client/api';
import type { Project } from '@/types';

/**
 * Kopf des Projekts mit dem Gelb-Grün-Balken. Für die Swiss Solar Ventures AG
 * zusätzlich mit Umbenennen und Duplizieren.
 */
export default function ProjectHeader({
  project,
  isAdmin,
  refreshing,
  onRefresh,
  onRenamed,
  onDuplicated,
}: {
  project: Project;
  isAdmin: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRenamed: (project: Project) => void;
  onDuplicated: (project: Project) => void;
}) {
  const { toast, reportError } = useFeedback();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [ort, setOrt] = useState(project.ort ?? '');
  const [busy, setBusy] = useState(false);

  const [menuOffen, setMenuOffen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Menü schliesst bei Klick daneben und mit Escape – sonst bliebe es auf dem
  // Handy offen stehen, wo es keinen Rand zum "Wegklicken" gibt.
  useEffect(() => {
    if (!menuOffen) return;

    function beiKlick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOffen(false);
    }
    function beiTaste(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOffen(false);
    }

    document.addEventListener('mousedown', beiKlick);
    document.addEventListener('keydown', beiTaste);
    return () => {
      document.removeEventListener('mousedown', beiKlick);
      document.removeEventListener('keydown', beiTaste);
    };
  }, [menuOffen]);

  const [duplicating, setDuplicating] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [copyOrt, setCopyOrt] = useState('');
  const [withTodos, setWithTodos] = useState(true);
  const [withAccess, setWithAccess] = useState(true);

  function startEdit() {
    setName(project.name);
    setOrt(project.ort ?? '');
    setEditing(true);
  }

  function startDuplicate() {
    setCopyName(`${project.name} (Kopie)`);
    setCopyOrt(project.ort ?? '');
    setWithTodos(true);
    setWithAccess(true);
    setDuplicating(true);
  }

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const { project: updated } = await patch<{ project: Project }>(
        `/api/projects/${project.id}`,
        { name: name.trim(), ort: ort.trim() },
      );
      onRenamed(updated);
      setEditing(false);
      toast('✓ Projekt gespeichert.');
    } catch (error) {
      reportError(error, 'Projekt konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  }

  async function duplicate() {
    if (!copyName.trim() || busy) return;
    setBusy(true);
    try {
      const { project: created, hinweise } = await post<{
        project: Project;
        hinweise: string[];
      }>(`/api/projects/${project.id}/duplicate`, {
        name: copyName.trim(),
        ort: copyOrt.trim(),
        withTodos,
        withAccess,
      });

      setDuplicating(false);
      onDuplicated(created);
      toast(`✓ „${created.name}“ angelegt.`);

      // Teilweise misslungene Übernahmen nicht verschlucken.
      if (hinweise?.length) {
        reportError(new Error(hinweise.join(' · ')), 'Nicht alles übernommen.');
      }
    } catch (error) {
      reportError(error, 'Projekt konnte nicht dupliziert werden.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="project-sign">
        <div className="stripe-bar" />
        <div className="sign-body">
          {editing ? (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="eyebrow">Projekt umbenennen</div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
                placeholder="Projektname"
                autoFocus
                style={{
                  width: '100%',
                  padding: '9px 11px',
                  border: '1px solid var(--accent)',
                  borderRadius: 8,
                  fontSize: 16,
                  marginTop: 6,
                }}
              />
              <input
                type="text"
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
                placeholder="Ort / Adresse (optional)"
                style={{
                  width: '100%',
                  padding: '9px 11px',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  fontSize: 13.5,
                  marginTop: 8,
                }}
              />
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-accent btn-sm"
                  onClick={save}
                  disabled={busy}
                >
                  Speichern
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">Projekt</div>
                <h1>{project.name}</h1>
                {project.ort && <div className="ploc">📍 {project.ort}</div>}
              </div>

              {/* Ein Menü statt drei Knöpfen: auf dem Handy war die Knopfreihe
                  breiter als die Karte und lief aus dem Bild. */}
              <div className="sign-menu" ref={menuRef}>
                <button
                  type="button"
                  className="menu-btn"
                  onClick={() => setMenuOffen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={menuOffen}
                  aria-label="Projekt-Menü"
                  title="Projekt-Menü"
                >
                  <span className={refreshing ? 'spin' : ''}>
                    {refreshing ? '⟳' : '⋯'}
                  </span>
                </button>

                {menuOffen && (
                  <div className="menu-list" role="menu">
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          className="menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMenuOffen(false);
                            startEdit();
                          }}
                        >
                          ✏️ Umbenennen
                        </button>
                        <button
                          type="button"
                          className="menu-item"
                          role="menuitem"
                          onClick={() => {
                            setMenuOffen(false);
                            startDuplicate();
                          }}
                        >
                          ⧉ Duplizieren
                        </button>
                        <div className="menu-trenner" />
                      </>
                    )}
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOffen(false);
                        onRefresh();
                      }}
                      disabled={refreshing}
                    >
                      ⟳ Aktualisieren
                    </button>
                    {/* Holt nur die Daten neu. Wenn etwas hakt oder eine neue
                        Version veröffentlicht wurde, hilft der komplette Neustart. */}
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => window.location.reload()}
                      title="Lädt die gesamte App neu"
                    >
                      ⟲ Seite neu laden
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {duplicating && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setDuplicating(false);
          }}
        >
          <div className="modal">
            <h3>Projekt duplizieren</h3>
            <p>
              Legt ein neues Projekt nach dem Vorbild von „{project.name}“ an.
              Kommentare, Dateien und das Aktivitätsprotokoll werden nicht übernommen.
            </p>

            <label
              htmlFor="copy-name"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}
            >
              Name des neuen Projekts
            </label>
            <input
              id="copy-name"
              type="text"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              autoFocus
              style={{ marginTop: 5 }}
            />

            <label
              htmlFor="copy-ort"
              style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}
            >
              Ort / Adresse
            </label>
            <input
              id="copy-ort"
              type="text"
              value={copyOrt}
              onChange={(e) => setCopyOrt(e.target.value)}
              placeholder="optional"
              style={{ marginTop: 5 }}
            />

            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 13.5,
                marginBottom: 8,
              }}
            >
              <input
                type="checkbox"
                checked={withTodos}
                onChange={(e) => setWithTodos(e.target.checked)}
                style={{ width: 'auto', margin: '3px 0 0' }}
              />
              <span>
                Aufgabenliste übernehmen
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>
                  Alle Aufgaben werden als offen angelegt, auch die erledigten.
                </span>
              </span>
            </label>

            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 13.5,
                marginBottom: 16,
              }}
            >
              <input
                type="checkbox"
                checked={withAccess}
                onChange={(e) => setWithAccess(e.target.checked)}
                style={{ width: 'auto', margin: '3px 0 0' }}
              />
              <span>
                Lieferanten-Freigaben übernehmen
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>
                  Dieselben Lieferanten erhalten Zugriff, mit ihren bisherigen Codes.
                </span>
              </span>
            </label>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-accent"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={duplicate}
                disabled={busy || !copyName.trim()}
              >
                {busy ? 'Wird angelegt…' : 'Duplizieren'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setDuplicating(false)}
                disabled={busy}
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
