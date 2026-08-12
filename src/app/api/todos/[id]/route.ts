import { ApiError, forbidden, handler, ok, readJson, requireString } from '@/lib/api';
import { requireSession, type Ctx } from '@/lib/auth/guards';
import { requireProjectAccess } from '@/lib/auth/guards';
import { assigneeDisplayName, resolveAssignee } from '@/lib/auth/assignTarget';
import { logActivity } from '@/lib/activity';
import { parseDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

type TodoRow = {
  id: string;
  project_id: string;
  text: string;
  assigned_to: string;
  done: boolean;
  created_by_supplier_id: string | null;
};

async function loadTodo(ctx: Ctx, id: string): Promise<TodoRow> {
  const { data } = await serviceClient()
    .from('todos')
    .select('id, project_id, text, assigned_to, done, created_by_supplier_id')
    .eq('id', id)
    .maybeSingle();

  if (!data) throw new ApiError('Aufgabe nicht gefunden.', 404);
  await requireProjectAccess(ctx, data.project_id);
  return data as TodoRow;
}

/**
 * Abhaken darf jeder mit Projektzugriff. Text und Zuweisung ändert der Admin für alle
 * Aufgaben, ein Lieferant nur bei selbst erstellten – dieselbe Regel erzwingt der
 * Trigger todos_supplier_update_guard zusätzlich in der Datenbank.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const todo = await loadTodo(ctx, id);

  const body = await readJson<{
    done?: boolean;
    text?: string;
    assignedTo?: string;
    dueDate?: string | null;
  }>(request);

  const isSupplier = ctx.session.kind === 'supplier';
  const ownsTodo =
    isSupplier &&
    todo.created_by_supplier_id !== null &&
    ctx.session.kind === 'supplier' &&
    todo.created_by_supplier_id === ctx.session.supplierId;

  const wantsContentChange =
    body.text !== undefined ||
    body.assignedTo !== undefined ||
    body.dueDate !== undefined;

  if (wantsContentChange && isSupplier && !ownsTodo) {
    throw forbidden('Du kannst fremde Aufgaben nur abhaken, nicht bearbeiten.');
  }

  const patch: Record<string, unknown> = {};

  if (body.text !== undefined) {
    patch.text = requireString(body.text, 'Aufgabe', 1000);
  }

  if (body.assignedTo !== undefined) {
    patch.assigned_to = await resolveAssignee(
      ctx.session,
      todo.project_id,
      body.assignedTo,
    );
  }

  if (body.dueDate !== undefined) {
    patch.due_date = parseDueDate(body.dueDate);
    // Neue Frist heisst: neu mahnen. Sonst bliebe eine einmal verschickte Mahnung
    // für alle Zeiten das letzte Wort, auch wenn die Frist verschoben wurde.
    patch.overdue_notified_at = null;
  }

  if (wantsContentChange) patch.edited_at = new Date().toISOString();

  if (body.done !== undefined) {
    patch.done = Boolean(body.done);
    patch.done_by = body.done ? ctx.session.name : null;
    patch.done_at = body.done ? new Date().toISOString() : null;
  }

  if (!Object.keys(patch).length) throw new ApiError('Keine Änderung übergeben.');

  const { data, error } = await ctx.db
    .from('todos')
    .update(patch)
    .eq('id', id)
    .select(
      'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index, due_date',
    )
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  const actorEmail = ctx.session.kind === 'admin' ? ctx.session.email : null;
  let warning: string | null = null;

  if (body.done === true && !todo.done) {
    warning = await logActivity(ctx.db, {
      projectId: todo.project_id,
      actorName: ctx.session.name,
      actorEmail,
      text: `hat To-Do "${data.text}" als erledigt markiert`,
      icon: '✓',
    });
  }

  // Wird eine Aufgabe an jemand anderen übergeben, erfährt der neue Zuständige
  // sonst nichts davon – deshalb ein eigener Protokolleintrag samt Benachrichtigung.
  if (
    patch.assigned_to !== undefined &&
    patch.assigned_to !== todo.assigned_to
  ) {
    const empfaenger = await assigneeDisplayName(String(patch.assigned_to));
    warning =
      (await logActivity(ctx.db, {
        projectId: todo.project_id,
        actorName: ctx.session.name,
        actorEmail,
        text: `hat To-Do "${data.text}" an ${empfaenger} übergeben`,
        icon: '➡️',
      })) ?? warning;
  }

  return ok({ todo: data, warning });
});

/** Löschen: der Admin alles, ein Lieferant nur selbst erstellte Aufgaben. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const todo = await loadTodo(ctx, id);

  if (
    ctx.session.kind === 'supplier' &&
    todo.created_by_supplier_id !== ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur selbst erstellte Aufgaben löschen.');
  }

  const { error } = await ctx.db.from('todos').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
