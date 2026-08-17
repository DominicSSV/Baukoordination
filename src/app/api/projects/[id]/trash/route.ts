import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { STORAGE_BUCKET } from '@/lib/env';
import { logActivity } from '@/lib/activity';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Zurückholen oder endgültig entfernen.
 *
 * Angezeigt wird der Papierkorb projektübergreifend (/api/trash); ausgeführt
 * wird hier, wo die Projektkennung im Pfad steht und damit mitgeprüft wird.
 *
 * Nur für die Swiss Solar Ventures AG: Zurückholen greift in etwas ein, das
 * jemand anders weggeworfen hat.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    art?: 'todo' | 'datei';
    id?: string;
    aktion?: 'wiederherstellen' | 'entfernen';
  }>(request);

  const art = body.art === 'datei' ? 'datei' : 'todo';
  const tabelle = art === 'datei' ? 'files' : 'todos';
  const id = body.id?.trim();
  if (!id) throw new ApiError('Kein Eintrag übergeben.');

  const gefunden = await ctx.db
    .from(tabelle)
    .select(
      art === 'datei'
        ? 'id, name, project_id, storage_path, thumb_path'
        : 'id, text, project_id',
    )
    .eq('id', id)
    .maybeSingle();

  const zeile = gefunden.data as unknown as {
    project_id: string;
    name?: string;
    text?: string;
    storage_path?: string;
    thumb_path?: string | null;
  } | null;

  if (!zeile || zeile.project_id !== projectId) {
    throw new ApiError('Eintrag nicht gefunden.', 404);
  }

  const bezeichnung = (art === 'datei' ? zeile.name : zeile.text) ?? 'Eintrag';

  if (body.aktion === 'entfernen') {
    const { error } = await ctx.db.from(tabelle).delete().eq('id', id);
    if (error) throw new ApiError(`Entfernen fehlgeschlagen: ${error.message}`, 500);

    if (art === 'datei') {
      const pfade = [zeile.storage_path, zeile.thumb_path].filter(
        (p): p is string => Boolean(p),
      );
      const removal = await serviceClient()
        .storage.from(STORAGE_BUCKET)
        .remove(pfade);
      if (removal.error) {
        console.error('[storage] Datei nicht entfernt', removal.error);
      }
    }

    return ok({ ok: true });
  }

  const { error } = await ctx.db
    .from(tabelle)
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', id);

  if (error) {
    throw new ApiError(`Wiederherstellen fehlgeschlagen: ${error.message}`, 500);
  }

  const warning = await logActivity(ctx.db, {
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.email,
    text: `hat "${bezeichnung}" aus dem Papierkorb zurückgeholt`,
    icon: '♻️',
  });

  return ok({ ok: true, warning });
});
