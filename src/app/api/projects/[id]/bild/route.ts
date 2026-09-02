import { randomUUID } from 'crypto';
import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { AVATAR_BUCKET, signAvatar } from '@/lib/avatars';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Das Bild der Liegenschaft.
 *
 * Setzen darf es jeder mit Zugriff auf das Projekt – dieselbe Regel wie bei den
 * übrigen Projektinfos. Wer vor Ort steht, hat das Foto ohnehin schon auf dem
 * Handy; es erst über uns laufen zu lassen hiesse, dass es nie hochgeladen wird.
 *
 * Entfernen bleibt bei uns: Ergänzen ist harmlos, Wegnehmen nicht.
 *
 * Der fehlende Ordner "projekte/<id>" wird nicht angelegt – im Ablageort
 * entsteht er mit der ersten Datei von selbst.
 */
function ordner(projectId: string): string {
  return `projekte/${projectId}`;
}

async function bisherigerPfad(projectId: string): Promise<string | null> {
  const { data } = await serviceClient()
    .from('projects')
    .select('bild_path')
    .eq('id', projectId)
    .maybeSingle();

  return (data as { bild_path?: string | null } | null)?.bild_path ?? null;
}

/** Schritt 1: Upload vorbereiten. Der Browser lädt danach direkt in den Speicher. */
export const POST = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  // Zufälliger Name pro Upload, damit ein ausgetauschtes Bild nicht aus dem
  // Zwischenspeicher des Browsers kommt.
  const pfad = `${ordner(projectId)}/${randomUUID()}.jpg`;

  const upload = await serviceClient()
    .storage.from(AVATAR_BUCKET)
    .createSignedUploadUrl(pfad);

  if (upload.error) {
    throw new ApiError(
      `Upload konnte nicht vorbereitet werden: ${upload.error.message}. `
        + `Existiert der Speicher "${AVATAR_BUCKET}" (Migration 0005)?`,
      500,
    );
  }

  return ok({ bucket: AVATAR_BUCKET, path: pfad, token: upload.data.token });
});

/** Schritt 2: Nach dem Upload den Pfad übernehmen und das alte Bild entfernen. */
export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ path?: string }>(request);
  const pfad = requireString(body.path, 'Pfad', 300);

  // Der Pfad kommt vom Browser zurück. Ohne diese Prüfung liesse sich damit das
  // Bild eines fremden Projekts oder ein Profilbild als eigenes ausgeben.
  if (!pfad.startsWith(`${ordner(projectId)}/`)) {
    throw new ApiError('Der gemeldete Pfad gehört nicht zu diesem Projekt.', 400);
  }

  const alt = await bisherigerPfad(projectId);

  const { error } = await serviceClient()
    .from('projects')
    .update({ bild_path: pfad })
    .eq('id', projectId);

  if (error) {
    throw new ApiError(
      'Das Bild lässt sich erst nach der Datenbank-Aktualisierung 0034 '
        + `speichern: ${error.message}`,
      400,
    );
  }

  if (alt && alt !== pfad) {
    await serviceClient().storage.from(AVATAR_BUCKET).remove([alt]);
  }

  return ok({ bildUrl: await signAvatar(pfad) });
});

/** Bild entfernen – wie beim Löschen der übrigen Angaben nur für uns. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  await requireAdmin();

  const alt = await bisherigerPfad(projectId);

  const { error } = await serviceClient()
    .from('projects')
    .update({ bild_path: null })
    .eq('id', projectId);

  if (error) {
    throw new ApiError(`Bild konnte nicht entfernt werden: ${error.message}`, 500);
  }

  if (alt) await serviceClient().storage.from(AVATAR_BUCKET).remove([alt]);

  return ok({ ok: true });
});
