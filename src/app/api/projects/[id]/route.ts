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

  const body = await readJson<{ name?: string; ort?: string }>(request);
  const name = requireString(body.name, 'Projektname', 200);

  const { data, error } = await ctx.db
    .from('projects')
    .update({ name, ort: optionalString(body.ort, 200) })
    .eq('id', id)
    .select('id, name, ort, created_at')
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  return ok({ project: data });
});
