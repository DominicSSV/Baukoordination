import {
  ApiError,
  handler,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { requireAdmin, requireProjectAccess } from '@/lib/auth/guards';
import type { DokumentOrdner } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Ohne Migration 0019 fehlt die Tabelle – dann sagen wir das, statt zu scheitern. */
const FEHLT =
  'Die Ordner stehen erst nach der Datenbank-Aktualisierung 0019 zur Verfügung.';

/**
 * Ordner anlegen, umbenennen und löschen.
 *
 * Nur die Swiss Solar Ventures AG: Die Gliederung ist die Ordnung des Projekts.
 * Sehen dürfen sie alle Beteiligten – das regelt die Policy in Migration 0019,
 * gelesen werden sie mit dem Projekt selbst.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ name?: string; parentId?: string | null }>(request);
  const name = requireString(body.name, 'Ordnername', 60);
  const parentId = optionalString(body.parentId, 64);

  // Der übergeordnete Ordner muss zu diesem Projekt gehören und selbst ganz
  // oben stehen – mehr als zwei Ebenen gibt es nicht. Die Datenbank prüft
  // dasselbe noch einmal (Migration 0021).
  if (parentId) {
    const eltern = await ctx.db
      .from('document_folders')
      .select('id, parent_id')
      .eq('id', parentId)
      .eq('project_id', projectId)
      .maybeSingle();

    if (eltern.error) throw new ApiError(FEHLT, 400);
    if (!eltern.data) throw new ApiError('Der übergeordnete Ordner gehört nicht zu diesem Projekt.');
    if (eltern.data.parent_id) {
      throw new ApiError('In einem Unterordner lässt sich kein weiterer Ordner anlegen.');
    }
  }

  // Die höchste vergebene Nummer auf derselben Ebene, damit der neue Ordner
  // hinten anhängt statt zwischen die bestehenden zu rutschen.
  const geschwister = ctx.db
    .from('document_folders')
    .select('position')
    .eq('project_id', projectId)
    .order('position', { ascending: false })
    .limit(1);

  const letzte = await (parentId
    ? geschwister.eq('parent_id', parentId)
    : geschwister.is('parent_id', null)
  ).maybeSingle();

  if (letzte.error) throw new ApiError(FEHLT, 400);

  const { data, error } = await ctx.db
    .from('document_folders')
    .insert({
      project_id: projectId,
      parent_id: parentId,
      name,
      position: (letzte.data?.position ?? 0) + 1,
    })
    .select('id, name, position, parent_id')
    .single();

  if (error) {
    // 23505 = die Namenssperre aus Migration 0019 hat zugeschlagen.
    if (error.code === '23505') {
      throw new ApiError(`Es gibt bereits einen Ordner „${name}“.`);
    }
    throw new ApiError(`Ordner konnte nicht angelegt werden: ${error.message}`, 500);
  }

  return ok({ ordner: data as DokumentOrdner }, { status: 201 });
});

/** Umbenennen. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ ordnerId?: string; name?: string }>(request);
  const ordnerId = requireString(body.ordnerId, 'ordnerId', 64);
  const name = requireString(body.name, 'Ordnername', 60);

  const { data, error } = await ctx.db
    .from('document_folders')
    .update({ name })
    .eq('id', ordnerId)
    .eq('project_id', projectId)
    .select('id, name, position, parent_id')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      throw new ApiError(`Es gibt bereits einen Ordner „${name}“.`);
    }
    throw new ApiError(`Umbenennen fehlgeschlagen: ${error.message}`, 500);
  }
  if (!data) throw new ApiError('Ordner nicht gefunden.', 404);

  return ok({ ordner: data as DokumentOrdner });
});

/** Löschen – nur wenn der Ordner leer ist. */
export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ ordnerId?: string }>(request);
  const ordnerId = requireString(body.ordnerId, 'ordnerId', 64);

  // Sichtbare Sperre. Die zweite steht als Trigger in der Datenbank und hält
  // auch dann, wenn jemand am SQL-Editor sitzt.
  const belegt = await ctx.db
    .from('files')
    .select('id')
    .eq('document_folder', ordnerId)
    .limit(1);

  if (belegt.error) throw new ApiError(FEHLT, 400);
  if (belegt.data?.length) {
    throw new ApiError(
      'Der Ordner enthält noch Dokumente. Bitte zuerst wegräumen oder löschen.',
    );
  }

  const unterordner = await ctx.db
    .from('document_folders')
    .select('id')
    .eq('parent_id', ordnerId)
    .limit(1);

  if (!unterordner.error && unterordner.data?.length) {
    throw new ApiError(
      'Der Ordner enthält noch Unterordner. Bitte zuerst wegräumen oder löschen.',
    );
  }

  const { error } = await ctx.db
    .from('document_folders')
    .delete()
    .eq('id', ordnerId)
    .eq('project_id', projectId);

  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
