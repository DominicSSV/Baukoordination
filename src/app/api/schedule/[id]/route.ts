import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { parseDueDate } from '@/lib/due';
import { pruefeFarbe } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    label?: string;
    responsible?: string | null;
    startDate?: string;
    endDate?: string;
    color?: string;
  }>(request);

  const patch: Record<string, unknown> = {};

  if (body.label !== undefined) patch.label = requireString(body.label, 'Arbeit', 200);
  if (body.responsible !== undefined) {
    patch.responsible = optionalString(body.responsible, 120);
  }
  if (body.startDate !== undefined) patch.start_date = parseDueDate(body.startDate);
  if (body.endDate !== undefined) patch.end_date = parseDueDate(body.endDate);
  if (body.color !== undefined) patch.color = pruefeFarbe(body.color);

  if (!Object.keys(patch).length) throw new ApiError('Keine Änderung übergeben.');

  if (
    typeof patch.start_date === 'string' &&
    typeof patch.end_date === 'string' &&
    patch.end_date < patch.start_date
  ) {
    throw new ApiError('Das Ende darf nicht vor dem Beginn liegen.');
  }

  const { data, error } = await ctx.db
    .from('schedule_tasks')
    .update(patch)
    .eq('id', id)
    .select(
      'id, project_id, responsible, label, start_date, end_date, color, order_index',
    )
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  return ok({ task: data });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { error } = await ctx.db.from('schedule_tasks').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
