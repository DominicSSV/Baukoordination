'use client';

import { useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import type { Project } from '@/types';

export default function Sidebar({
  projects,
  activeId,
  isAdmin,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  activeId: string | null;
  isAdmin: boolean;
  onSelect: (id: string) => void;
  onCreate: (name: string, ort: string) => Promise<void>;
}) {
  const { reportError } = useFeedback();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [ort, setOrt] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="sidebar">
      <h2>Projekte</h2>

      <div className="project-list">
        {projects.map((p) => (
          <button
            type="button"
            key={p.id}
            className={`project-item ${p.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(p.id)}
          >
            <div className="dot" />
            <div>
              <div className="pname">{p.name}</div>
              <div className="pmeta">{p.ort ?? ''}</div>
            </div>
          </button>
        ))}
      </div>

      {!isAdmin ? (
        projects.length ? null : (
          <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', padding: '8px 4px' }}>
            Dir wurde noch kein Projekt zugewiesen.
          </p>
        )
      ) : !showForm ? (
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
      )}
    </div>
  );
}
