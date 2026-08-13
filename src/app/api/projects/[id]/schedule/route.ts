import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { parseDueDate } from '@/lib/due';
import { pruefeFarbe } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Neue Zeile im Terminplan. Den Plan pflegt allein die Swiss Solar Ventures AG. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    label?: string;
    responsible?: string;
    startDate?: string;
    endDate?: string;
    color?: string;
  }>(request);

  const label = requireString(body.label, 'Arbeit', 200);
  const start = parseDueDate(body.startDate);
  const ende = parseDueDate(body.endDate);

  if (!start || !ende) throw new ApiError('Bitte Beginn und Ende angeben.');
  if (ende < start) throw new ApiError('Das Ende darf nicht vor dem Beginn liegen.');

  const { data: letzte } = await ctx.db
    .from('schedule_tasks')
    .select('order_index')
    .eq('project_id', projectId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.db
    .from('schedule_tasks')
    .insert({
      project_id: projectId,
      label,
      responsible: optionalString(body.responsible, 120),
      start_date: start,
      end_date: ende,
      color: pruefeFarbe(body.color),
      order_index: (letzte?.order_index ?? 0) + 1,
    })
    .select(
      'id, project_id, responsible, label, start_date, end_date, color, order_index',
    )
    .single();

  if (error) {
    throw new ApiError(`Eintrag konnte nicht angelegt werden: ${error.message}`, 500);
  }

  return ok({ task: data }, { status: 201 });
});
