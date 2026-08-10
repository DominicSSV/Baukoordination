import { randomUUID } from 'crypto';
import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Dateinamen auf ein für Storage-Pfade unbedenkliches Alphabet reduzieren. */
function safeName(name: string): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(-120);
  return cleaned || 'datei';
}

/**
 * Schritt 1 des Uploads: Berechtigung prüfen und Signed Upload URLs ausstellen.
 *
 * Der Browser lädt danach direkt in den Supabase-Storage. Dadurch läuft die Datei nie
 * durch eine Serverless-Funktion – es gibt also weder das 4.5-MB-Limit von Vercel noch
 * das 5-MB-Limit des Prototyps.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{
    name?: string;
    mimeType?: string;
    withThumb?: boolean;
    todoId?: string;
  }>(request);

  const name = requireString(body.name, 'Dateiname', 300);
  const todoId = optionalString(body.todoId, 64);

  // Ein Anhang darf nur an ein To-Do desselben Projekts gehängt werden.
  if (todoId) {
    const { data } = await serviceClient()
      .from('todos')
      .select('id')
      .eq('id', todoId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!data) throw new ApiError('Die Aufgabe gehört nicht zu diesem Projekt.');
  }

  const fileId = randomUUID();
  const storagePath = `${projectId}/${fileId}-${safeName(name)}`;
  const storage = serviceClient().storage.from(STORAGE_BUCKET);

  const upload = await storage.createSignedUploadUrl(storagePath);
  if (upload.error) {
    throw new ApiError(
      `Upload konnte nicht vorbereitet werden: ${upload.error.message}. ` +
        `Existiert der Storage-Bucket "${STORAGE_BUCKET}"?`,
      500,
    );
  }

  let thumb: { path: string; token: string } | null = null;
  if (body.withThumb) {
    const thumbPath = `${projectId}/thumbs/${fileId}.jpg`;
    const thumbUpload = await storage.createSignedUploadUrl(thumbPath);
    if (!thumbUpload.error) {
      thumb = { path: thumbPath, token: thumbUpload.data.token };
    }
  }

  return ok({
    fileId,
    bucket: STORAGE_BUCKET,
    storagePath,
    token: upload.data.token,
    thumb,
  });
});
