'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FeedbackProvider, useFeedback } from '@/components/Feedback';
import Sidebar from '@/components/workspace/Sidebar';
import SuppliersTab from '@/components/workspace/SuppliersTab';
import TodosTab from '@/components/workspace/TodosTab';
import FilesTab from '@/components/workspace/FilesTab';
import ActivityTab from '@/components/workspace/ActivityTab';
import MessageModal, { type MessageDraft } from '@/components/workspace/MessageModal';
import FileViewer from '@/components/workspace/FileViewer';
import Spinner from '@/components/Spinner';
import { api, post } from '@/lib/client/api';
import { browserClient } from '@/lib/supabase/browser';
import type { Project, ProjectDetail, SessionInfo } from '@/types';

export type TabKey = 'lieferanten' | 'todos' | 'dateien' | 'aktivitaet';

export default function Workspace(props: {
  session: SessionInfo;
  initialProjects: Project[];
}) {
  return (
    <FeedbackProvider>
      <WorkspaceInner {...props} />
    </FeedbackProvider>
  );
}

function WorkspaceInner({
  session,
  initialProjects,
}: {
  session: SessionInfo;
  initialProjects: Project[];
}) {
  const router = useRouter();
  const { toast, reportError } = useFeedback();
  const isAdmin = session.kind === 'admin';

  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [activeId, setActiveId] = useState<string | null>(
    initialProjects[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>(isAdmin ? 'lieferanten' : 'todos');
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<MessageDraft | null>(null);
  const [viewerFileId, setViewerFileId] = useState<string | null>(null);

  // Solange ein Projekt gewählt ist, aber noch keine Daten da sind und kein Fehler
  // vorliegt, läuft der Ladezustand – ein eigener State dafür wäre nur redundant.
  const loading = Boolean(activeId) && !detail && !detailError;

  const loadDetail = useCallback(
    async (projectId: string, silent = false) => {
      try {
        const { detail: loaded } = await api<{ detail: ProjectDetail }>(
          `/api/projects/${projectId}`,
        );
        setDetail(loaded);
        setDetailError(null);
      } catch (error) {
        const text =
          error instanceof Error
            ? error.message
            : 'Das Projekt konnte nicht geladen werden.';
        // Beim ersten Laden ersetzt die Fehlermeldung den Inhalt, beim Aktualisieren
        // bleibt der bisherige Stand stehen und der Toast weist auf das Problem hin.
        if (!silent) setDetailError(text);
        reportError(error, 'Das Projekt konnte nicht geladen werden.');
      }
    },
    [reportError],
  );

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;

    void (async () => {
      const { detail: loaded } = await api<{ detail: ProjectDetail }>(
        `/api/projects/${activeId}`,
      ).catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(
            error instanceof Error
              ? error.message
              : 'Das Projekt konnte nicht geladen werden.',
          );
        }
        return { detail: null };
      });

      if (!cancelled && loaded) {
        setDetail(loaded);
        setDetailError(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const reload = useCallback(async () => {
    if (activeId) await loadDetail(activeId, true);
  }, [activeId, loadDetail]);

  async function refresh() {
    if (!activeId) return;
    setRefreshing(true);
    try {
      await loadDetail(activeId, true);
    } finally {
      setRefreshing(false);
    }
  }

  function selectProject(id: string) {
    if (id === activeId) return;
    setActiveId(id);
    setDetail(null);
    setDetailError(null);
    setTab(isAdmin ? 'lieferanten' : 'todos');
  }

  async function createProject(name: string, ort: string) {
    const { project } = await post<{ project: Project }>('/api/projects', { name, ort });
    setProjects((current) => [...current, project]);
    setActiveId(project.id);
    setDetail(null);
    setDetailError(null);
    setTab('lieferanten');
    toast(`✓ Projekt „${project.name}“ angelegt.`);
  }

  async function logout() {
    try {
      if (session.kind === 'supplier') {
        await post('/api/supplier/logout');
      } else {
        await browserClient().auth.signOut();
      }
      router.replace(session.kind === 'supplier' ? '/' : '/admin');
      router.refresh();
    } catch (error) {
      reportError(error, 'Abmelden fehlgeschlagen.');
    }
  }

  const openTodos = detail?.todos.filter((t) => !t.done).length ?? 0;

  return (
    <div className="app-shell">
      {isAdmin && !session.rlsEnforced && (
        <div className="storage-warning">
          ⚠️ SUPABASE_JWT_SECRET fehlt – die Lieferanten-Zugriffe werden nur von der App
          geprüft, nicht zusätzlich von der Datenbank (RLS). Siehe README.md.
        </div>
      )}

      <div className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/logo.png" alt="Swiss Solar Ventures AG" />
          <div>
            <div className="brand-name">Baukoordination – Swiss Solar Ventures AG</div>
            <div className="brand-sub">Projekte · Lieferanten · To-Dos · Dateien</div>
          </div>
        </div>

        <div className="me-badge">
          <span>
            {session.kind === 'supplier' ? '🧰' : '👤'} {session.name}
            <span style={{ opacity: 0.6 }}>
              {session.kind === 'supplier'
                ? ' (Lieferant)'
                : session.funktion
                  ? ` · ${session.funktion}`
                  : ''}
            </span>
          </span>
          <button type="button" onClick={logout}>
            abmelden
          </button>
        </div>
      </div>

      <div className="layout">
        <Sidebar
          projects={projects}
          activeId={activeId}
          isAdmin={isAdmin}
          onSelect={selectProject}
          onCreate={createProject}
        />

        <div className="content">
          {loading ? (
            <div className="empty-state">
              <Spinner size={56} />
              <p style={{ marginTop: 14 }}>Lade Daten…</p>
            </div>
          ) : detailError && !detail ? (
            <div className="empty-state">
              <h3>Projekt konnte nicht geladen werden</h3>
              <p style={{ maxWidth: 460 }}>{detailError}</p>
              <button
                type="button"
                className="btn btn-accent"
                style={{ marginTop: 14 }}
                onClick={refresh}
              >
                Erneut versuchen
              </button>
            </div>
          ) : !activeId || !detail ? (
            <div className="empty-state">
              <h3>{projects.length ? 'Kein Projekt ausgewählt' : 'Noch keine Projekte'}</h3>
              <p>
                {projects.length
                  ? 'Wähle links ein Projekt aus.'
                  : isAdmin
                    ? 'Leg links dein erstes Projekt an, z.B. „Tägerwilen“.'
                    : 'Dir wurde noch kein Projekt zugewiesen. Bitte wende dich an die Swiss Solar Ventures AG.'}
              </p>
            </div>
          ) : (
            <>
              <div className="project-sign">
                <div className="stripe-bar" />
                <div className="sign-body">
                  <div>
                    <div className="eyebrow">Projekt</div>
                    <h1>{detail.project.name}</h1>
                    {detail.project.ort && (
                      <div className="ploc">📍 {detail.project.ort}</div>
                    )}
                  </div>
                  <div className="sign-actions">
                    <button
                      type="button"
                      className="refresh-btn"
                      onClick={refresh}
                      disabled={refreshing}
                    >
                      <span className={refreshing ? 'spin' : ''}>⟳</span> Aktualisieren
                    </button>
                  </div>
                </div>
              </div>

              <div className="info-banner">
                ℹ️{' '}
                {isAdmin
                  ? 'Lieferanten sehen nach der Anmeldung mit ihrem Zugangscode ausschliesslich die Projekte, für die du sie freigibst – und dort keine Zugangscodes oder Kontaktdaten anderer Lieferanten.'
                  : 'Du siehst nur die Projekte, für die du freigegeben bist. Aufgaben abhaken, kommentieren sowie Fotos und Dokumente hochladen ist jederzeit möglich.'}
              </div>

              <div className="tabs">
                {isAdmin && (
                  <button
                    type="button"
                    className={`tab-btn ${tab === 'lieferanten' ? 'active' : ''}`}
                    onClick={() => setTab('lieferanten')}
                  >
                    Lieferanten <span className="tab-count">{detail.accessIds.length}</span>
                  </button>
                )}
                <button
                  type="button"
                  className={`tab-btn ${tab === 'todos' ? 'active' : ''}`}
                  onClick={() => setTab('todos')}
                >
                  To-Dos <span className="tab-count">{openTodos}</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${tab === 'dateien' ? 'active' : ''}`}
                  onClick={() => setTab('dateien')}
                >
                  Dateien <span className="tab-count">{detail.files.length}</span>
                </button>
                <button
                  type="button"
                  className={`tab-btn ${tab === 'aktivitaet' ? 'active' : ''}`}
                  onClick={() => setTab('aktivitaet')}
                >
                  Aktivität <span className="tab-count">{detail.activity.length}</span>
                </button>
              </div>

              {tab === 'lieferanten' && isAdmin && (
                <SuppliersTab
                  detail={detail}
                  reload={reload}
                  onMessage={setMessage}
                  mailEnabled={session.mailEnabled}
                />
              )}
              {tab === 'todos' && (
                <TodosTab
                  session={session}
                  detail={detail}
                  reload={reload}
                  onOpenFile={setViewerFileId}
                />
              )}
              {tab === 'dateien' && (
                <FilesTab detail={detail} reload={reload} onOpenFile={setViewerFileId} />
              )}
              {tab === 'aktivitaet' && (
                <ActivityTab
                  detail={detail}
                  isAdmin={isAdmin}
                  onMessage={setMessage}
                />
              )}
            </>
          )}
        </div>
      </div>

      {message && <MessageModal draft={message} onClose={() => setMessage(null)} />}
      {viewerFileId && (
        <FileViewer fileId={viewerFileId} onClose={() => setViewerFileId(null)} />
      )}
    </div>
  );
}
