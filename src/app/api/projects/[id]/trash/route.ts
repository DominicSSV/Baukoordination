import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { STORAGE_BUCKET } from '@/lib/env';
import { logActivity } from '@/lib/activity';
import { serviceClient } from '@/lib/supabase/service';
import type { PapierkorbEintrag } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Der Papierkorb eines Projekts – Aufgaben und Dateien, die weggeworfen wurden.
 *
 * Nur für die Swiss Solar Ventures AG: Wiederherstellen greift in Dinge ein, die
 * jemand anders entfernt hat, und das soll bei uns bleiben.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const [aufgaben, dateien] = await Promise.all([
    ctx.db
      .from('todos')
      .select('id, text, deleted_at, deleted_by')
      .eq('project_id', projectId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    ctx.db
      .from('files')
      .select('id, name, offer_folder, size_bytes, deleted_at, deleted_by')
      .eq('project_id', projectId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
  ]);

  // Ohne Migration 0017 gibt es die Spalten noch nicht – dann ist der Korb leer.
  if (aufgaben.error || dateien.error) {
    return ok({
      eintraege: [] as PapierkorbEintrag[],
      hinweis:
        'Der Papierkorb steht erst nach Migration 0017 zur Verfügung. Bis dahin ' +
        'wird wie bisher endgültig gelöscht.',
    });
  }

  const eintraege: PapierkorbEintrag[] = [
    ...((aufgaben.data ?? []) as Array<{
      id: string;
      text: string;
      deleted_at: string;
      deleted_by: string | null;
    }>).map((t) => ({
      art: 'todo' as const,
      id: t.id,
      text: t.text,
      zusatz: 'Aufgabe',
      deletedAt: t.deleted_at,
      deletedBy: t.deleted_by,
    })),
    ...((dateien.data ?? []) as Array<{
      id: string;
      name: string;
      offer_folder: string | null;
      deleted_at: string;
      deleted_by: string | null;
    }>).map((f) => ({
      art: 'datei' as const,
      id: f.id,
      text: f.name,
      zusatz: f.offer_folder ? 'Offerte' : 'Datei',
      deletedAt: f.deleted_at,
      deletedBy: f.deleted_by,
    })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return ok({ eintraege });
});

/** Zurückholen oder endgültig entfernen. */
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
