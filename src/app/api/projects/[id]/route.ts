import {
  ApiError,
  handler,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { loadProjectDetail } from '@/lib/projects';
import { parseDueDate } from '@/lib/due';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, id);

  return ok({ detail: await loadProjectDetail(ctx, id) });
});

/** Projektname und Ort ändern – nur die Swiss Solar Ventures AG. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    name?: string;
    ort?: string;
    scheduleStart?: string | null;
    scheduleEnd?: string | null;
    status?: string;
  }>(request);

  const patch: Record<string, unknown> = {};

  // Der Zeitraum lässt sich unabhängig vom Namen ändern; der Terminplan schickt
  // nur ihn, das Umbenennen-Formular nur Name und Ort.
  if (body.name !== undefined) {
    patch.name = requireString(body.name, 'Projektname', 200);
  }
  if (body.ort !== undefined) patch.ort = optionalString(body.ort, 200);
  if (body.scheduleStart !== undefined) {
    patch.schedule_start = parseDueDate(body.scheduleStart);
  }
  if (body.scheduleEnd !== undefined) {
    patch.schedule_end = parseDueDate(body.scheduleEnd);
  }
  if (body.status !== undefined) {
    const erlaubt = ['planung', 'umsetzung', 'abschluss', 'abgeschlossen'];
    if (!erlaubt.includes(String(body.status))) {
      throw new ApiError('Unbekannter Projektstatus.');
    }
    patch.status = body.status;
  }

  if (!Object.keys(patch).length) throw new ApiError('Keine Änderung übergeben.');

  const { data, error } = await ctx.db
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('id, name, ort, created_at, schedule_start, schedule_end, status, order_index')
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  return ok({ project: data });
});
