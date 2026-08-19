import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { fmtPlanDatum } from '@/lib/schedule';
import { parseDueDate } from '@/lib/due';
import { pruefeFarbe } from '@/lib/schedule';
import { pruefeZustaendigen } from '@/lib/auth/assignTarget';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    label?: string;
    responsible?: string | null;
    owner?: string | null;
    startDate?: string;
    endDate?: string;
    color?: string;
  }>(request);

  const patch: Record<string, unknown> = {};

  if (body.label !== undefined) patch.label = requireString(body.label, 'Arbeit', 200);
  if (body.responsible !== undefined) {
    patch.responsible = optionalString(body.responsible, 120);
  }
  if (body.owner !== undefined) {
    const { data: vorhanden } = await ctx.db
      .from('schedule_tasks')
      .select('project_id')
      .eq('id', id)
      .maybeSingle();
    patch.owner = await pruefeZustaendigen(
      ctx.session,
      (vorhanden as { project_id: string } | null)?.project_id ?? '',
      body.owner,
    );
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
      'id, project_id, responsible, owner, label, start_date, end_date, color, order_index',
    )
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  // Nur Termine und Bezeichnung sind eine Nachricht wert. Farbe, Reihenfolge
  // und Zuständigkeit ändern nichts daran, wann jemand auf der Baustelle sein
  // muss – dafür würde niemand eine Mail wollen.
  const inhaltlich =
    body.startDate !== undefined ||
    body.endDate !== undefined ||
    body.label !== undefined;

  const warning = inhaltlich
    ? await logActivity(ctx.db, {
        notify: true,
        projectId: (data as { project_id: string }).project_id,
        actorName: ctx.session.name,
        actorEmail: ctx.session.email,
        text: `hat "${(data as { label: string }).label}" im Terminplan geändert (${fmtPlanDatum(
          (data as { start_date: string }).start_date,
          (data as { end_date: string }).end_date,
        )})`,
        icon: '📅',
      })
    : null;

  return ok({ task: data, warning });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  // Vor dem Löschen lesen: danach ist nicht mehr feststellbar, was verschwand.
  const { data: vorher } = await ctx.db
    .from('schedule_tasks')
    .select('project_id, label')
    .eq('id', id)
    .maybeSingle();

  const { error } = await ctx.db.from('schedule_tasks').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  const zeile = vorher as { project_id: string; label: string } | null;
  const warning = zeile
    ? await logActivity(ctx.db, {
        notify: true,
        projectId: zeile.project_id,
        actorName: ctx.session.name,
        actorEmail: ctx.session.email,
        text: `hat "${zeile.label}" aus dem Terminplan entfernt`,
        icon: '📅',
      })
    : null;

  return ok({ ok: true, warning });
});
