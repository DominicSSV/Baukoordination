'use client';

import { useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtDate, supplierLabel } from '@/lib/format';
import { INTERNAL_PARTY } from '@/lib/branding';
import { adminAssignee, assigneeLabel, supplierAssignee } from '@/lib/assignee';
import Spinner from '@/components/Spinner';
import type { ProjectDetail, SessionInfo, Todo } from '@/types';

export default function TodosTab({
  session,
  detail,
  reload,
  onOpenFile,
}: {
  session: SessionInfo;
  detail: ProjectDetail;
  reload: () => Promise<void>;
  onOpenFile: (fileId: string) => void;
}) {
  const { toast, reportError, confirm } = useFeedback();
  const isAdmin = session.kind === 'admin';
  const projectId = detail.project.id;

  const [newText, setNewText] = useState('');
  const [newAssignee, setNewAssignee] = useState('internal');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editAssignee, setEditAssignee] = useState('internal');
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploadingTodo, setUploadingTodo] = useState<string | null>(null);

  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const cameraInputs = useRef<Record<string, HTMLInputElement | null>>({});

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

  function assigneeName(todo: Todo): string {
    return assigneeLabel(todo.assigned_to, detail.admins, detail.suppliers);
  }

  /** Admin darf alle Aufgaben bearbeiten, ein Lieferant nur selbst erstellte. */
  function canEdit(todo: Todo): boolean {
    if (isAdmin) return true;
    return (
      session.kind === 'supplier' &&
      todo.created_by_supplier_id !== null &&
      todo.created_by_supplier_id === session.supplierId
    );
  }

  const addTodo = () =>
    run(async () => {
      const text = newText.trim();
      if (!text) return;
      await post(`/api/projects/${projectId}/todos`, {
        text,
        assignedTo: newAssignee,
      });
      setNewText('');
      await reload();
      toast('✓ Aufgabe angelegt.');
    }, 'Aufgabe konnte nicht angelegt werden.');

  const toggleTodo = (todo: Todo) =>
    run(async () => {
      const result = await patch<{ warning: string | null }>(`/api/todos/${todo.id}`, {
        done: !todo.done,
      });
      await reload();
      if (result.warning) toast(`⚠️ ${result.warning}`, 'error');
    }, 'Der Status konnte nicht geändert werden.');

  const saveEdit = (todo: Todo) =>
    run(async () => {
      const text = editText.trim();
      if (!text) throw new Error('Die Aufgabe darf nicht leer sein.');
      await patch(`/api/todos/${todo.id}`, {
        text,
        assignedTo: editAssignee,
      });
      setEditingId(null);
      await reload();
      toast('✓ Aufgabe gespeichert.');
    }, 'Speichern fehlgeschlagen.');

  function removeTodo(todo: Todo) {
    confirm(`Aufgabe „${todo.text}“ wirklich löschen?`, async () => {
      await del(`/api/todos/${todo.id}`);
      await reload();
      toast('🗑️ Aufgabe gelöscht.');
    });
  }

  const moveTodo = (todo: Todo, direction: 'up' | 'down') =>
    run(async () => {
      await post(`/api/todos/${todo.id}/move`, { direction });
      await reload();
    }, 'Die Reihenfolge konnte nicht geändert werden.');

  const addComment = (todo: Todo) =>
    run(async () => {
      const text = (commentDrafts[todo.id] ?? '').trim();
      if (!text) return;
      const result = await post<{ warning: string | null }>(
        `/api/todos/${todo.id}/comments`,
        { text },
      );
      setCommentDrafts((d) => ({ ...d, [todo.id]: '' }));
      setOpenComments((s) => new Set(s).add(todo.id));
      await reload();
      if (result.warning) toast(`⚠️ ${result.warning}`, 'error');
    }, 'Kommentar konnte nicht gespeichert werden.');

  function removeComment(commentId: string) {
    confirm('Diesen Kommentar wirklich löschen?', async () => {
      await del(`/api/comments/${commentId}`);
      await reload();
    });
  }

  async function handleAttachments(todoId: string, files: FileList | null) {
    if (!files || !files.length) return;
    setUploadingTodo(todoId);
    try {
      const result = await uploadFiles({ projectId, todoId, files });
      await reload();

      if (result.errors.length) {
        reportError(new Error(result.errors.join(' · ')), 'Upload fehlgeschlagen.');
      }
      if (result.uploaded) {
        toast(`✓ ${result.uploaded} Datei(en) an die Aufgabe angehängt.`);
      }
    } catch (error) {
      reportError(error, 'Upload fehlgeschlagen.');
    } finally {
      setUploadingTodo(null);
    }
  }

  /**
   * Auswahl der Zuständigen. Ein Lieferant kann nur der Swiss Solar Ventures AG
   * zuweisen – allgemein oder einer bestimmten Person. Andere Lieferanten stehen
   * nur dem Bauherrenvertreter zur Auswahl.
   */
  function assigneeOptions(includeSuppliers: boolean) {
    return (
      <>
        <optgroup label={INTERNAL_PARTY}>
          <option value="internal">{INTERNAL_PARTY} (allgemein)</option>
          {detail.admins.map((a) => (
            <option key={a.user_id} value={adminAssignee(a.user_id)}>
              {a.funktion ? `${a.name} · ${a.funktion}` : a.name}
            </option>
          ))}
        </optgroup>
        {includeSuppliers && detail.suppliers.length > 0 && (
          <optgroup label="Lieferanten">
            {detail.suppliers.map((s) => (
              <option key={s.id} value={supplierAssignee(s.id)}>
                {supplierLabel(s)}
              </option>
            ))}
          </optgroup>
        )}
      </>
    );
  }

  return (
    <div className="card">
      <div className="section-head">
        <h2>Aufgaben</h2>
      </div>

      {detail.todos.length ? (
        detail.todos.map((todo, index) => {
          const attachments = detail.files.filter((f) => f.todo_id === todo.id);
          const commentsOpen = openComments.has(todo.id);

          if (editingId === todo.id) {
            return (
              <div key={todo.id} className="todo-row todo-row-editing">
                <button
                  type="button"
                  className={`checkbox ${todo.done ? 'checked' : ''}`}
                  onClick={() => toggleTodo(todo)}
                >
                  {todo.done ? '✓' : ''}
                </button>
                <div style={{ flex: 1 }}>
                  <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void saveEdit(todo);
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 9px',
                      border: '1px solid var(--accent)',
                      borderRadius: 6,
                      fontSize: 14,
                      marginBottom: 6,
                    }}
                    autoFocus
                  />
                  <select
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    style={{
                      padding: '6px 8px',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      fontSize: 12.5,
                    }}
                  >
                    {assigneeOptions(isAdmin)}
                  </select>
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      onClick={() => saveEdit(todo)}
                      disabled={busy}
                    >
                      Speichern
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditingId(null)}
                      disabled={busy}
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div key={todo.id} className="todo-row">
              {isAdmin && (
                <div className="reorder-buttons">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => moveTodo(todo, 'up')}
                    disabled={index === 0 || busy}
                    title="Nach oben"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => moveTodo(todo, 'down')}
                    disabled={index === detail.todos.length - 1 || busy}
                    title="Nach unten"
                  >
                    ▼
                  </button>
                </div>
              )}

              <button
                type="button"
                className={`checkbox ${todo.done ? 'checked' : ''}`}
                onClick={() => toggleTodo(todo)}
                title={todo.done ? 'Als offen markieren' : 'Als erledigt markieren'}
              >
                {todo.done ? '✓' : ''}
              </button>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className={`todo-text ${todo.done ? 'done' : ''}`}>{todo.text}</div>
                <div className="todo-meta">
                  <span className="assignee-chip">{assigneeName(todo)}</span>
                  <span>
                    angelegt {fmtDate(todo.created_at)} von {todo.created_by}
                    {todo.edited_at ? ` · bearbeitet ${fmtDate(todo.edited_at)}` : ''}
                  </span>
                  {todo.done && (
                    <span className="stamp">✓ ERLEDIGT · {todo.done_by ?? ''}</span>
                  )}
                </div>

                {/* Kommentare */}
                {!commentsOpen ? (
                  <button
                    type="button"
                    className="comment-toggle"
                    onClick={() => setOpenComments((s) => new Set(s).add(todo.id))}
                  >
                    {todo.comments.length
                      ? `💬 ${todo.comments.length} Kommentar${todo.comments.length === 1 ? '' : 'e'}`
                      : '💬 Kommentieren'}
                  </button>
                ) : (
                  <div className="todo-comments">
                    <button
                      type="button"
                      className="comment-toggle"
                      onClick={() =>
                        setOpenComments((s) => {
                          const next = new Set(s);
                          next.delete(todo.id);
                          return next;
                        })
                      }
                    >
                      {todo.comments.length
                        ? `💬 ${todo.comments.length} Kommentar${todo.comments.length === 1 ? '' : 'e'} ▲`
                        : '💬 Kommentieren ▲'}
                    </button>

                    {todo.comments.length ? (
                      todo.comments.map((c) => {
                        const mine =
                          session.kind === 'admin'
                            ? c.author_supplier_id === null
                            : c.author_supplier_id === session.supplierId;
                        return (
                          <div key={c.id} className="comment-row">
                            <div className="comment-text">{c.text}</div>
                            <div className="comment-meta">
                              {c.author} · {fmtDate(c.created_at)}
                              {(mine || isAdmin) && (
                                <button
                                  type="button"
                                  onClick={() => removeComment(c.id)}
                                  title="Kommentar löschen"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="comment-empty">Noch keine Kommentare.</div>
                    )}

                    <div className="comment-add-row">
                      <input
                        type="text"
                        value={commentDrafts[todo.id] ?? ''}
                        onChange={(e) =>
                          setCommentDrafts((d) => ({ ...d, [todo.id]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void addComment(todo);
                        }}
                        placeholder="Kommentar hinzufügen…"
                      />
                      <button
                        type="button"
                        className="btn btn-accent btn-sm"
                        onClick={() => addComment(todo)}
                        disabled={busy}
                      >
                        Senden
                      </button>
                    </div>
                  </div>
                )}

                {/* Anhänge */}
                <div className="todo-attachments">
                  {attachments.length > 0 && (
                    <div className="todo-attach-grid">
                      {attachments.map((f) => (
                        <div
                          key={f.id}
                          className="todo-attach-thumb"
                          onClick={() => onOpenFile(f.id)}
                          title={f.name}
                        >
                          {f.thumb_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={f.thumb_url} alt={f.name} loading="lazy" />
                          ) : (
                            <span>📄</span>
                          )}
                          {f.can_delete && (
                            <button
                              type="button"
                              className="todo-attach-del"
                              title="Löschen"
                              onClick={(e) => {
                                e.stopPropagation();
                                confirm('Diese Datei wirklich löschen?', async () => {
                                  await del(`/api/files/${f.id}`);
                                  await reload();
                                });
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="todo-attach-actions">
                    <button
                      type="button"
                      className="attach-btn"
                      onClick={() => fileInputs.current[todo.id]?.click()}
                      disabled={uploadingTodo === todo.id}
                    >
                      {uploadingTodo === todo.id ? (
                        <Spinner size={14} label="Lädt…" />
                      ) : (
                        '📎 Datei'
                      )}
                    </button>
                    <button
                      type="button"
                      className="attach-btn"
                      onClick={() => cameraInputs.current[todo.id]?.click()}
                      disabled={uploadingTodo === todo.id}
                    >
                      📷 Foto
                    </button>
                    <input
                      ref={(el) => {
                        fileInputs.current[todo.id] = el;
                      }}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        void handleAttachments(todo.id, e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <input
                      ref={(el) => {
                        cameraInputs.current[todo.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        void handleAttachments(todo.id, e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              </div>

              {canEdit(todo) && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Bearbeiten"
                  onClick={() => {
                    setEditingId(todo.id);
                    setEditText(todo.text);
                    setEditAssignee(todo.assigned_to);
                  }}
                >
                  ✏️
                </button>
              )}
              {isAdmin && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Löschen"
                  onClick={() => removeTodo(todo)}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })
      ) : (
        <div className="empty-state" style={{ padding: '36px 10px' }}>
          <p>Keine Aufgaben vorhanden.</p>
        </div>
      )}

      {/* Aufgaben anlegen dürfen beide Seiten – ein Lieferant kann sie aber nur der
          Swiss Solar Ventures AG zuweisen, nicht einem anderen Lieferanten. */}
      <div className="todo-add-row">
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTodo();
            }}
            placeholder="Neue Aufgabe, z.B. „Fenster im OG kontrollieren“"
          />
          <select value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)}>
            {assigneeOptions(isAdmin)}
          </select>
          <button
            type="button"
            className="btn btn-accent"
            onClick={addTodo}
            disabled={busy}
          >
            + Aufgabe
          </button>
      </div>
    </div>
  );
}
