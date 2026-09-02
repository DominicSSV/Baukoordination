'use client';

import { useMemo, useRef, useState } from 'react';
import { useFeedback } from '@/components/Feedback';
import { del, patch, post } from '@/lib/client/api';
import { uploadFiles } from '@/lib/client/upload';
import { fmtDate } from '@/lib/format';
import {
  fmtDueDate,
  fristBlock,
  istHeuteFaellig,
  istUeberfaellig,
  nachFrist,
} from '@/lib/due';
import { assigneeLabel, parseAssignee } from '@/lib/assignee';
import Spinner from '@/components/Spinner';
import UploadNamesModal from '@/components/workspace/UploadNamesModal';
import AssigneePicker from '@/components/workspace/AssigneePicker';
import WhatsAppButton from '@/components/workspace/WhatsAppButton';
import { appLink, todoText, waNummer } from '@/lib/whatsapp';
import Avatar from '@/components/Avatar';
import { assigneePerson, findPerson, personLabel } from '@/lib/people';
import { spieleMuenze, spieleSchade } from '@/lib/client/ton';
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
  const [editMeilenstein, setEditMeilenstein] = useState(false);

  // Aufgaben gehen immer an eine bestimmte Person. Nur solange noch gar kein
  // Bauherrenvertreter hinterlegt ist (Migration 0002 nicht eingespielt), bleibt
  // die Firma als Ganzes als Rückfall stehen – sonst liesse sich nichts zuweisen.
  const hasAdmins = detail.admins.length > 0;

  // Bewusst keine Vorauswahl: wer eine Aufgabe anlegt, soll sich entscheiden,
  // wer sie erledigt. Sonst landet im Alltag alles beim ersten Namen der Liste.
  /**
   * Mehrfachauswahl zum Aufräumen.
   *
   * Bewusst ein eigener Zustand statt eines zweiten Hakens an jeder Zeile: Ein
   * Kästchen zum Abhaken und eines zum Anwählen nebeneinander verwechselt man
   * unweigerlich – und eines davon hakt Aufgaben ab, die niemand erledigt hat.
   * Deshalb wird die Liste ausdrücklich in den Auswahlmodus geschaltet.
   */
  const [auswahlModus, setAuswahlModus] = useState(false);
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set());

  /**
   * Wonach die Liste geordnet ist.
   *
   * Standard ist die Frist: Das ist die Reihenfolge, in der man die Aufgaben
   * abarbeitet, und sie stellt sich von selbst ein, sobald jemand ein Datum
   * setzt. Von Hand schieben lässt sich trotzdem – nur nicht gleichzeitig, das
   * eine würde das andere sofort wieder umsortieren.
   */
  const [nachFristSortieren, setNachFristSortieren] = useState(true);

  /**
   * Die Liste in der Reihenfolge, in der sie angezeigt wird.
   *
   * Bewusst nur hier und nicht in der Datenbank: order_index bleibt die selbst
   * gewählte Reihenfolge. Sonst wäre sie beim ersten gesetzten Datum
   * unwiederbringlich überschrieben.
   */
  const aufgaben = useMemo(
    () => (nachFristSortieren ? nachFrist(detail.todos) : detail.todos),
    [detail.todos, nachFristSortieren],
  );

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
      // Belohnung gefühlt zum falschen Handgriff. Rückwärts gibt es die
      // traurige Posaune – wer einen Haken wegnimmt, hat sich das verdient.
      if (todo.done) spieleSchade();
      else spieleMuenze();

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
        meilenstein: editMeilenstein,
        dueDate: editDue || null,
      });
      setEditingId(null);
      await reload();
      toast('✓ Aufgabe gespeichert.');
    }, 'Speichern fehlgeschlagen.');

  /**
   * Die angewählten Aufgaben wegwerfen.
   *
   * Sie landen im Papierkorb, nicht im Nichts – gerade hier: Wer zweihundert
   * Zeilen auf einmal anwählt, klickt sich auch mal eine zu viel dazu.
   */
  function mehrereLoeschen() {
    const ids = [...gewaehlt];
    if (!ids.length) return;

    confirm(
      `${ids.length} Aufgabe${ids.length === 1 ? '' : 'n'} in den Papierkorb legen? ` +
        'Von dort lassen sie sich 30 Tage lang zurückholen.',
      async () => {
        setBusy(true);
        try {
          const res = await post<{ anzahl: number; papierkorb: boolean }>(
            '/api/todos/bulk-delete',
            { ids },
          );
          setGewaehlt(new Set());
          setAuswahlModus(false);
          await reload();
          toast(
            res.papierkorb
              ? `🗑️ ${res.anzahl} in den Papierkorb gelegt.`
              : `🗑️ ${res.anzahl} gelöscht.`,
          );
        } catch (error) {
          reportError(error, 'Löschen fehlgeschlagen.');
        } finally {
          setBusy(false);
        }
      },
    );
  }

  function waehlen(id: string) {
    setGewaehlt((bisher) => {
      const neu = new Set(bisher);
      if (neu.has(id)) neu.delete(id);
      else neu.add(id);
      return neu;
    });
  }

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
        <div className="kontakt-knoepfe">
          {/* Von Hand schieben und nach Frist ordnen schliessen sich aus: Der
              Pfeil nach oben wäre wirkungslos, sobald das Datum entscheidet.
              Deshalb ein Umschalter statt zweier Bedienungen nebeneinander. */}
          {detail.todos.length > 1 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setNachFristSortieren((s) => !s)}
              title={
                nachFristSortieren
                  ? 'Zur selbst gewählten Reihenfolge wechseln – dort lassen '
                    + 'sich die Aufgaben wieder verschieben.'
                  : 'Nach Frist ordnen: das Dringendste zuoberst.'
              }
            >
              {nachFristSortieren ? '📅 Nach Frist' : '↕ Eigene Reihenfolge'}
            </button>
          )}
          {isAdmin && detail.todos.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setAuswahlModus((a) => !a);
                setGewaehlt(new Set());
                setEditingId(null);
              }}
            >
              {auswahlModus ? 'Auswahl beenden' : '☑ Mehrere auswählen'}
            </button>
          )}
        </div>
      </div>

      {/* Bleibt beim Scrollen stehen: Bei zweihundert Zeilen wäre der Knopf
          sonst ganz oben und die letzte angewählte Zeile ganz unten. */}
      {auswahlModus && (
        <div className="auswahl-leiste">
          <span className="auswahl-zahl">
            {gewaehlt.size} von {detail.todos.length} ausgewählt
          </span>
          <div className="kontakt-knoepfe">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setGewaehlt(
                  gewaehlt.size === detail.todos.length
                    ? new Set()
                    : new Set(detail.todos.map((t) => t.id)),
                )
              }
            >
              {gewaehlt.size === detail.todos.length ? 'Keine' : 'Alle'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                setGewaehlt(
                  new Set(detail.todos.filter((t) => t.meilenstein).map((t) => t.id)),
                )
              }
            >
              🏁 Nur Meilensteine
            </button>
            <button
              type="button"
              className="btn btn-sm btn-gefaehrlich"
              onClick={mehrereLoeschen}
              disabled={busy || !gewaehlt.size}
            >
              {busy ? 'Wird weggeräumt…' : `🗑️ ${gewaehlt.size} löschen`}
            </button>
          </div>
        </div>
      )}

      {aufgaben.length ? (
        aufgaben.map((todo, index) => {
          const attachments = detail.files.filter((f) => f.todo_id === todo.id);
          const commentsOpen = openComments.has(todo.id);

          /**
           * Wo die Aufgaben mit Frist aufhören.
           *
           * Ohne diese Zwischenzeile sieht die Liste falsch sortiert aus: Nach
           * dem letzten Datum kommen unvermittelt Aufgaben ohne, und das wirkt
           * wie ein Fehler statt wie eine Ordnung.
           */
          const trenner =
            nachFristSortieren &&
            index > 0 &&
            fristBlock(todo) !== fristBlock(aufgaben[index - 1])
              ? 'Ohne Frist'
              : null;

          const zwischenzeile = trenner ? (
            <div key={`${todo.id}-trenner`} className="todo-trenner">
              {trenner}
            </div>
          ) : null;

          // Zwischenzeile und Aufgabe als Paar: So bleibt die Zeile darunter
          // eingerückt wie zuvor, statt in einer zusätzlichen Ebene zu sitzen.
          if (editingId === todo.id) {
            return [
              zwischenzeile,
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
                  {isAdmin && (
                    <label className="vertraulich-feld">
                      <input
                        type="checkbox"
                        checked={editMeilenstein}
                        onChange={(e) => setEditMeilenstein(e.target.checked)}
                      />
                      🏁 Meilenstein – fester Schritt des Projekts
                    </label>
                  )}
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
              </div>,
            ];
          }

          return [
            zwischenzeile,
            <div
              key={todo.id}
              className={`todo-row ${todo.meilenstein ? 'meilenstein' : ''} ${
                auswahlModus && gewaehlt.has(todo.id) ? 'gewaehlt' : ''
              }`}
            >
              {auswahlModus && (
                <input
                  type="checkbox"
                  className="auswahl-kaestchen"
                  checked={gewaehlt.has(todo.id)}
                  onChange={() => waehlen(todo.id)}
                  aria-label={`„${todo.text}" auswählen`}
                />
              )}
              {/* Nur in der eigenen Reihenfolge: Nach Frist geordnet würde die
                  Liste nach jedem Schieben an dieselbe Stelle zurückspringen. */}
              {isAdmin && !nachFristSortieren && (
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
                    disabled={index === aufgaben.length - 1 || busy}
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
                  {todo.meilenstein && (
                    <span className="meilenstein-chip" title="Fester Schritt des Projekts">
                      🏁 Meilenstein
                    </span>
                  )}
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
                    setEditMeilenstein(todo.meilenstein);
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
            </div>,
          ];
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
