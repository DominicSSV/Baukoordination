import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import type { ProjektInfo } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Ändern darf jeder mit Zugriff auf das Projekt – auch die Lieferanten.
 *
 * Zu welchem Projekt der Eintrag gehört, steht nicht in der Adresse, deshalb
 * wird er zuerst nachgeschlagen. Ohne das könnte jemand mit Zugriff auf ein
 * Projekt Einträge eines fremden ändern; die RLS-Regel fängt das zwar auch ab,
 * aber die Anwendung soll es gar nicht erst versuchen.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: eintrag } = await ctx.db
    .from('project_infos')
    .select('project_id')
    .eq('id', id)
    .maybeSingle();

  if (!eintrag) throw new ApiError('Eintrag nicht gefunden.', 404);
  await requireProjectAccess(ctx, (eintrag as { project_id: string }).project_id);

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
