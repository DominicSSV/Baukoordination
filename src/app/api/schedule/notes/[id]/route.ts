import { ApiError, forbidden, handler, ok, readJson } from '@/lib/api';
import { requireAdmin, requireSession } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { fmtDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Über einen Vorschlag entscheiden: übernehmen oder ablehnen.
 * Beim Übernehmen wandert der vorgeschlagene Zeitraum in den Plan.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { entscheidung } = await readJson<{ entscheidung?: string }>(request);
  if (entscheidung !== 'uebernehmen' && entscheidung !== 'ablehnen') {
    throw new ApiError('Bitte übernehmen oder ablehnen.');
  }

  const { data: note } = await serviceClient()
    .from('schedule_notes')
    .select('id, task_id, vorschlag_start, vorschlag_ende, author')
    .eq('id', id)
    .maybeSingle();

  if (!note) throw new ApiError('Rückmeldung nicht gefunden.', 404);

  const { data: task } = await serviceClient()
    .from('schedule_tasks')
    .select('id, project_id, label')
    .eq('id', note.task_id)
    .maybeSingle();

  if (!task) throw new ApiError('Die zugehörige Arbeit gibt es nicht mehr.', 404);

  if (entscheidung === 'uebernehmen') {
    if (!note.vorschlag_start || !note.vorschlag_ende) {
      throw new ApiError('Diese Rückmeldung enthält keinen Zeitraum zum Übernehmen.');
    }

    const verschieben = await ctx.db
      .from('schedule_tasks')
      .update({ start_date: note.vorschlag_start, end_date: note.vorschlag_ende })
      .eq('id', note.task_id);

    if (verschieben.error) {
      throw new ApiError(`Termin konnte nicht verschoben werden: ${verschieben.error.message}`, 500);
    }
  }

  const { error } = await ctx.db
    .from('schedule_notes')
    .update({ status: entscheidung === 'uebernehmen' ? 'uebernommen' : 'abgelehnt' })
    .eq('id', id);

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  const warning = await logActivity(ctx.db, {
    projectId: task.project_id,
    actorName: ctx.session.name,
    actorEmail: ctx.session.email,
    text:
      entscheidung === 'uebernehmen'
        ? `hat "${task.label}" auf ${fmtDueDate(note.vorschlag_start)} bis ${fmtDueDate(note.vorschlag_ende)} verschoben (Vorschlag von ${note.author})`
        : `hat den Terminvorschlag von ${note.author} für "${task.label}" abgelehnt`,
    icon: entscheidung === 'uebernehmen' ? '📅' : '✕',
  });

  return ok({ ok: true, warning });
});

/** Eigene Anmerkung zurücknehmen; fremde entfernt nur der Bauherrenvertreter. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: note } = await serviceClient()
    .from('schedule_notes')
    .select('id, author_supplier_id')
    .eq('id', id)
    .maybeSingle();

  if (!note) throw new ApiError('Rückmeldung nicht gefunden.', 404);

  if (
    ctx.session.kind === 'supplier' &&
    note.author_supplier_id !== ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur eigene Anmerkungen entfernen.');
  }

  const { error } = await ctx.db.from('schedule_notes').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
