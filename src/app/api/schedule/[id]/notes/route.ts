import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { parseDueDate } from '@/lib/due';
import { fmtDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Anmerkung oder Verschiebe-Vorschlag zu einer Arbeit im Terminplan.
 *
 * Ein Vorschlag ändert den Plan bewusst nicht – er landet als Rückmeldung beim
 * Bauherrenvertreter, der ihn übernimmt oder ablehnt. So bleibt der Plan das,
 * was die Swiss Solar Ventures AG verantwortet.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: taskId } = await params;
  const ctx = await requireSession();

  const { data: task } = await serviceClient()
    .from('schedule_tasks')
    .select('id, project_id, label, start_date, end_date')
    .eq('id', taskId)
    .maybeSingle();

  if (!task) throw new ApiError('Diese Arbeit gibt es nicht (mehr).', 404);
  await requireProjectAccess(ctx, task.project_id);

  const body = await readJson<{
    text?: string;
    vorschlagStart?: string | null;
    vorschlagEnde?: string | null;
  }>(request);

  const text = requireString(body.text, 'Anmerkung', 1000);
  const start = parseDueDate(body.vorschlagStart);
  const ende = parseDueDate(body.vorschlagEnde);

  if ((start && !ende) || (!start && ende)) {
    throw new ApiError('Für einen Vorschlag bitte Beginn und Ende angeben.');
  }
  if (start && ende && ende < start) {
    throw new ApiError('Das Ende darf nicht vor dem Beginn liegen.');
  }

  const { data, error } = await ctx.db
    .from('schedule_notes')
    .insert({
      task_id: taskId,
      text,
      author: ctx.session.name,
      author_supplier_id:
        ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
      vorschlag_start: start,
      vorschlag_ende: ende,
    })
    .select(
      'id, task_id, text, author, author_supplier_id, vorschlag_start, vorschlag_ende, status, created_at',
    )
    .single();

  if (error) {
    throw new ApiError(`Anmerkung konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  const warning = await logActivity(ctx.db, {
    projectId: task.project_id,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    text:
      start && ende
        ? `schlägt für "${task.label}" den Zeitraum ${fmtDueDate(start)} bis ${fmtDueDate(ende)} vor: "${text}"`
        : `hat zum Terminplan "${task.label}" angemerkt: "${text}"`,
    icon: start && ende ? '📅' : '💬',
  });

  return ok({ note: data, warning }, { status: 201 });
});
