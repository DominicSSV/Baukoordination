import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { ProjektInfo } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Ändern. Die Projektprüfung übernimmt die Datenbank über die RLS-Regel. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ titel?: string; text?: string }>(request);

  const { data, error } = await ctx.db
    .from('project_infos')
    .update({
      titel: requireString(body.titel, 'Titel', 120),
      text: optionalString(body.text, 2000),
    })
    .eq('id', id)
    .select('id, titel, text, sortierung')
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);
  return ok({ info: data as ProjektInfo });
});

/** Löschen – endgültig, wie bei den Kontakten. Eine Zeile ist schnell neu erfasst. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { error } = await ctx.db.from('project_infos').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
