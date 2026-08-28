'use client';

import { useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtDate } from '@/lib/format';
import {
  fmtDueDate,
  istHeuteFaellig,
  istUeberfaellig,
} from '@/lib/due';
import { assigneeLabel, parseAssignee } from '@/lib/assignee';
import Spinner from '@/components/Spinner';
import UploadNamesModal from '@/components/workspace/UploadNamesModal';
import AssigneePicker from '@/components/workspace/AssigneePicker';
import WhatsAppButton from '@/components/workspace/WhatsAppButton';
import { appLink, todoText, waNummer } from '@/lib/whatsapp';
import Avatar from '@/components/Avatar';
import { assigneePerson, findPerson, personLabel } from '@/lib/people';
import { spieleMuenze } from '@/lib/client/ton';
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
  const [newAssignees, setNewAssignees] = useState<string[]>([]);
  const [newDue, setNewDue] = useState('');
  // Vertraulich = nur wir und die beteiligten Lieferantenfirmen sehen die Aufgabe.
  const [newVertraulich, setNewVertraulich] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editAssignees, setEditAssignees] = useState<string[]>([]);
  const [editDue, setEditDue] = useState('');
  const [editVertraulich, setEditVertraulich] = useState(false);

  // Aufgaben gehen immer an eine bestimmte Person. Nur solange noch gar kein
  // Bauherrenvertreter hinterlegt ist (Migration 0002 nicht eingespielt), bleibt
  // die Firma als Ganzes als Rückfall stehen – sonst liesse sich nichts zuweisen.
  const hasAdmins = detail.admins.length > 0;

  // Bewusst keine Vorauswahl: wer eine Aufgabe anlegt, soll sich entscheiden,
  // wer sie erledigt. Sonst landet im Alltag alles beim ersten Namen der Liste.
  const [openComments, setOpenComments] = useState<Set<string>>(new Set());
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [uploadingTodo, setUploadingTodo] = useState<string | null>(null);
  // Anhänge werden vor dem Hochladen benannt, damit sie später auffindbar sind.
  const [wartend, setWartend] = useState<{ todoId: string; files: File[] } | null>(
    null,
  );

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

  /** Ein Merkzeichen je Zuständigem – eine Aufgabe kann mehreren gehören. */
  function assigneeChip(todo: Todo) {
    const liste = todo.assignees?.length ? todo.assignees : [todo.assigned_to];

    return liste.map((wert) => {
      const person = assigneePerson(detail, wert);
      return (
        <span
          key={wert}
          className="assignee-chip"
          title={assigneeLabel(wert, detail.admins, detail.suppliers)}
        >
          <Avatar url={person.avatarUrl} name={person.name} size={18} />
          {personLabel(person)}
        </span>
      );
    });
  }

  /**
   * Empfänger für eine WhatsApp-Nachricht zu dieser Aufgabe.
   *
   * Nur wenn genau ein Lieferant zuständig ist und dessen Telefonnummer im
   * Profil steht, geht es direkt in den richtigen Chat. Bei mehreren
   * Zuständigen wäre jede Wahl geraten – dann öffnet WhatsApp die Kontaktliste.
   */
  function waEmpfaenger(todo: Todo): { name: string | null; nummer: string | null } {
    const liste = todo.assignees?.length ? todo.assignees : [todo.assigned_to];
    const lieferanten = liste
      .map((wert) => parseAssignee(wert))
      .filter((a) => a.kind === 'supplier');

    if (lieferanten.length !== 1) return { name: null, nummer: null };

    const s = detail.suppliers.find((x) => x.id === lieferanten[0].id);
    return s ? { name: s.name, nummer: waNummer(s.kontakt) } : { name: null, nummer: null };
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
      if (!newAssignees.length) {
        throw new Error('Bitte wähle mindestens eine zuständige Person.');
      }
      await post(`/api/projects/${projectId}/todos`, {
        text,
        assignees: newAssignees,
        vertraulich: newVertraulich,
        dueDate: newDue || null,
      });
      setNewText('');
      setNewAssignees([]);
      setNewDue('');
      setNewVertraulich(false);
      await reload();
      toast('✓ Aufgabe angelegt.');
    }, 'Aufgabe konnte nicht angelegt werden.');

  const toggleTodo = (todo: Todo) =>
    run(async () => {
      // Der Ton kommt sofort beim Antippen, nicht erst wenn der Server antwortet:
      // Auf der Baustelle dauert das gerne eine Sekunde, und dann käme die
      // Belohnung gefühlt zum falschen Handgriff. Nur beim Abhaken, nicht beim
      // Wieder-Öffnen – rückwärts wäre es Hohn.
      if (!todo.done) spieleMuenze();

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
      if (!editAssignees.length) {
        throw new Error('Bitte wähle mindestens eine zuständige Person.');
      }
      await patch(`/api/todos/${todo.id}`, {
        text,
        assignees: editAssignees,
        vertraulich: editVertraulich,
        dueDate: editDue || null,
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

  function handleAttachments(todoId: string, files: FileList | null) {
    if (!files || !files.length) return;
    setWartend({ todoId, files: Array.from(files) });
  }

  async function anhaengeHochladen(namen: string[]) {
    const auftrag = wartend;
    setWartend(null);
    if (!auftrag) return;

    const todoId = auftrag.todoId;
    setUploadingTodo(todoId);
    try {
      const result = await uploadFiles({
        projectId,
        todoId,
        files: auftrag.files,
        namen,
      });
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

  return (
    <div className="card">
      {wartend && (
        <UploadNamesModal
          files={wartend.files}
          titel="Anhänge benennen"
          onAbbrechen={() => setWartend(null)}
          onBestaetigen={anhaengeHochladen}
        />
      )}

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
                  <AssigneePicker
                    value={editAssignees}
                    onChange={setEditAssignees}
                    admins={detail.admins}
                    suppliers={isAdmin ? detail.suppliers : []}
                    erlaubtIntern={!hasAdmins}
                  />
                  <label
                    style={{
                      display: 'block',
                      fontSize: 11.5,
                      color: 'var(--ink-soft)',
                      margin: '8px 0 3px',
                    }}
                  >
                    Zu erledigen bis
                  </label>
                  <label className="vertraulich-feld">
                    <input
                      type="checkbox"
                      checked={editVertraulich}
                      onChange={(e) => setEditVertraulich(e.target.checked)}
                    />
                    🔒 Vertraulich – nur für uns und die beteiligten Firmen
                  </label>
                  <input
                    type="date"
                    value={editDue}
                    onChange={(e) => setEditDue(e.target.value)}
                    style={{
                      padding: '6px 8px',
                      border: '1px solid var(--line)',
                      borderRadius: 6,
                      fontSize: 12.5,
                    }}
                  />
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
                  {todo.vertraulich && (
                    <span
                      className="vertraulich-chip"
                      title="Nur für uns und die beteiligten Firmen sichtbar"
                    >
                      🔒 Vertraulich
                    </span>
                  )}
                  {assigneeChip(todo)}
                  {todo.due_date && (
                    <span
                      className={`due-chip ${
                        istUeberfaellig(todo.due_date, todo.done)
                          ? 'overdue'
                          : istHeuteFaellig(todo.due_date, todo.done)
                            ? 'today'
                            : ''
                      }`}
                      title={
                        istUeberfaellig(todo.due_date, todo.done)
                          ? 'Frist überschritten'
                          : 'Zu erledigen bis'
                      }
                    >
                      {istUeberfaellig(todo.due_date, todo.done) ? '⏰' : '📅'}{' '}
                      {fmtDueDate(todo.due_date)}
                    </span>
                  )}
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
                        const person = findPerson(detail, {
                          name: c.author,
                          supplierId: c.author_supplier_id,
                        });

                        return (
                          <div key={c.id} className="comment-row">
                            <div className="comment-text">{c.text}</div>
                            <div className="comment-meta">
                              <Avatar
                                url={person.avatarUrl}
                                name={person.name}
                                size={16}
                              />
                              {personLabel(person)} · {fmtDate(c.created_at)}
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
                        handleAttachments(todo.id, e.target.files);
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
                        handleAttachments(todo.id, e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Nur wir verschicken Aufgaben weiter: Ein Lieferant bekäme über
                  diesen Weg sonst die Telefonnummern der anderen Firmen. */}
              {isAdmin && !todo.done && (
                <WhatsAppButton
                  klasse="icon-btn"
                  beschriftung=""
                  nummer={waEmpfaenger(todo).nummer}
                  titel={
                    waEmpfaenger(todo).nummer
                      ? 'Aufgabe per WhatsApp senden'
                      : 'WhatsApp öffnen – Empfänger dort auswählen'
                  }
                  text={todoText(
                    waEmpfaenger(todo).name,
                    detail.project.name,
                    todo.text,
                    todo.due_date ? fmtDueDate(todo.due_date) : null,
                    appLink(detail.project.id, 'todos'),
                  )}
                />
              )}
              {canEdit(todo) && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Bearbeiten"
                  onClick={() => {
                    setEditingId(todo.id);
                    setEditText(todo.text);
                    setEditAssignees(
                      todo.assignees?.length ? todo.assignees : [todo.assigned_to],
                    );
                    setEditVertraulich(todo.vertraulich);
                    setEditDue(todo.due_date ?? '');
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
          <AssigneePicker
            value={newAssignees}
            onChange={setNewAssignees}
            admins={detail.admins}
            suppliers={isAdmin ? detail.suppliers : []}
            erlaubtIntern={!hasAdmins}
          />
          <input
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            title="Zu erledigen bis (optional)"
            aria-label="Zu erledigen bis"
          />
          <label
            className="vertraulich-feld"
            title="Nur wir und die zugewiesenen Firmen sehen diese Aufgabe – andere Lieferanten nicht."
          >
            <input
              type="checkbox"
              checked={newVertraulich}
              onChange={(e) => setNewVertraulich(e.target.checked)}
            />
            🔒 Vertraulich
          </label>
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
