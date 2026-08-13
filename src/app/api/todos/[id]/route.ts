import { ApiError, forbidden, handler, ok, readJson, requireString } from '@/lib/api';
import { requireSession, type Ctx } from '@/lib/auth/guards';
import { requireProjectAccess } from '@/lib/auth/guards';
import { assigneeDisplayName, resolveAssignees } from '@/lib/auth/assignTarget';
import { logActivity } from '@/lib/activity';
import { beteiligteLieferanten } from '@/lib/beteiligte';
import { parseDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Dieselbe Änderung ohne die neuen Spalten – für Datenbanken vor 0014/0015. */
function ohneNeueSpalten(patch: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...patch };
  delete rest.assignees;
  delete rest.vertraulich;
  return rest;
}

type Params = { params: Promise<{ id: string }> };

type TodoRow = {
  id: string;
  project_id: string;
  text: string;
  assigned_to: string;
  assignees: string[] | null;
  vertraulich: boolean;
  done: boolean;
  created_by_supplier_id: string | null;
};

async function loadTodo(ctx: Ctx, id: string): Promise<TodoRow> {
  const db = serviceClient();

  const mitListe = await db
    .from('todos')
    .select(
      'id, project_id, text, assigned_to, assignees, vertraulich, done, created_by_supplier_id',
    )
    .eq('id', id)
    .maybeSingle();

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const res = mitListe.error
    ? await db
        .from('todos')
        .select('id, project_id, text, assigned_to, done, created_by_supplier_id')
        .eq('id', id)
        .maybeSingle()
    : mitListe;

  if (!res.data) throw new ApiError('Aufgabe nicht gefunden.', 404);
  await requireProjectAccess(ctx, (res.data as { project_id: string }).project_id);
  const zeile = res.data as Omit<TodoRow, 'assignees' | 'vertraulich'> & {
    assignees?: string[] | null;
    vertraulich?: boolean | null;
  };
  return {
    ...zeile,
    assignees: zeile.assignees ?? null,
    vertraulich: Boolean(zeile.vertraulich),
  };
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
    assignees?: string[];
    vertraulich?: boolean;
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
    body.assignees !== undefined ||
    body.vertraulich !== undefined ||
    body.dueDate !== undefined;

  if (wantsContentChange && isSupplier && !ownsTodo) {
    throw forbidden('Du kannst fremde Aufgaben nur abhaken, nicht bearbeiten.');
  }

  const patch: Record<string, unknown> = {};

  if (body.text !== undefined) {
    patch.text = requireString(body.text, 'Aufgabe', 1000);
  }

  if (body.assignees !== undefined || body.assignedTo !== undefined) {
    const zustaendige = await resolveAssignees(
      ctx.session,
      todo.project_id,
      body.assignees ?? body.assignedTo,
    );
    // assigned_to bleibt der erste Eintrag – Mahnungen und Protokolltexte,
    // die nur einen Zuständigen kennen, greifen weiterhin darauf zu.
    patch.assigned_to = zustaendige[0];
    patch.assignees = zustaendige;
  }

  if (body.vertraulich !== undefined) patch.vertraulich = Boolean(body.vertraulich);

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

  const SPALTEN =
    'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index, due_date';

  const mitListe = await ctx.db
    .from('todos')
    .update(patch)
    .eq('id', id)
    .select(`${SPALTEN}, assignees, vertraulich`)
    .single();

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const { data, error } = mitListe.error
    ? await ctx.db
        .from('todos')
        .update(ohneNeueSpalten(patch))
        .eq('id', id)
        .select(SPALTEN)
        .single()
    : mitListe;

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  const actorEmail = ctx.session.kind === 'admin' ? ctx.session.email : null;
  let warning: string | null = null;

  // Bleibt die Aufgabe vertraulich, bleiben auch die Protokolleinträge dazu bei
  // den Beteiligten – vor und nach einer Umverteilung.
  const jetztVertraulich =
    patch.vertraulich !== undefined ? Boolean(patch.vertraulich) : todo.vertraulich;

  const beteiligte = jetztVertraulich
    ? {
        nurFuerSupplierIds: Array.from(
          new Set([
            ...beteiligteLieferanten(todo),
            ...beteiligteLieferanten({
              assignees: (patch.assignees as string[] | undefined) ?? null,
              created_by_supplier_id: todo.created_by_supplier_id,
            }),
          ]),
        ),
      }
    : {};

  if (body.done === true && !todo.done) {
    warning = await logActivity(ctx.db, {
      projectId: todo.project_id,
      actorName: ctx.session.name,
      actorEmail,
      text: `hat To-Do "${data.text}" als erledigt markiert`,
      icon: '✓',
      ...beteiligte,
    });
  }

  // Wird eine Aufgabe an jemand anderen übergeben, erfährt der neue Zuständige
  // sonst nichts davon – deshalb ein eigener Protokolleintrag samt Benachrichtigung.
  const neueZustaendige = patch.assignees as string[] | undefined;
  const geaendert =
    neueZustaendige !== undefined &&
    neueZustaendige.join('|') !== (todo.assignees ?? [todo.assigned_to]).join('|');

  if (geaendert) {
    const empfaenger = (
      await Promise.all(neueZustaendige.map((z) => assigneeDisplayName(z)))
    ).join(', ');
    warning =
      (await logActivity(ctx.db, {
        projectId: todo.project_id,
        actorName: ctx.session.name,
        actorEmail,
        text: `hat To-Do "${data.text}" an ${empfaenger} übergeben`,
        icon: '➡️',
        ...beteiligte,
      })) ?? warning;
  }

  return ok({ todo: data, warning });
});

/** Wegwerfen: der Admin alles, ein Lieferant nur selbst erstellte Aufgaben. */
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

  // Wegwerfen statt löschen: die Aufgabe liegt 30 Tage im Papierkorb.
  const { error } = await ctx.db
    .from('todos')
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.session.name })
    .eq('id', id);

  // Ohne Migration 0017 gibt es den Papierkorb noch nicht.
  if (error) {
    const { error: hart } = await ctx.db.from('todos').delete().eq('id', id);
    if (hart) throw new ApiError(`Löschen fehlgeschlagen: ${hart.message}`, 500);
  }

  return ok({ ok: true });
});
