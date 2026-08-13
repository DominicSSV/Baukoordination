import { ApiError, forbidden, handler, ok } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const VIEW_URL_TTL = 60 * 60;

type Datei = {
  id: string;
  project_id: string;
  name: string;
  mime_type: string | null;
  storage_path: string;
  thumb_path: string | null;
  uploaded_by_supplier_id: string | null;
  offer_folder: string | null;
};

type Sitzung = Awaited<ReturnType<typeof requireSession>>;

async function loadFile(id: string): Promise<Datei> {
  const { data } = await serviceClient()
    .from('files')
    .select(
      'id, project_id, name, mime_type, storage_path, thumb_path, uploaded_by_supplier_id, offer_folder',
    )
    .eq('id', id)
    .maybeSingle();

  if (data) return data as Datei;

  // Ohne Migration 0012 gibt es die Ordnerspalte noch nicht.
  const { data: ohneOrdner } = await serviceClient()
    .from('files')
    .select(
      'id, project_id, name, mime_type, storage_path, thumb_path, uploaded_by_supplier_id',
    )
    .eq('id', id)
    .maybeSingle();

  if (!ohneOrdner) throw new ApiError('Datei nicht gefunden.', 404);
  return { ...(ohneOrdner as Omit<Datei, 'offer_folder'>), offer_folder: null };
}

/**
 * Offerten sind vertraulich. Die Datenbank blendet sie für fremde Lieferanten
 * zwar aus, diese Route liest aber bewusst mit Dienstschlüssel – also wird hier
 * noch einmal ausdrücklich geprüft.
 */
function pruefeOffertenzugriff(ctx: Sitzung, file: Datei) {
  if (!file.offer_folder) return;
  if (ctx.session.kind !== 'supplier') return;
  if (file.uploaded_by_supplier_id === ctx.session.supplierId) return;
  throw new ApiError('Datei nicht gefunden.', 404);
}

/** Kurzlebige Signed URL auf die Originaldatei – für Vorschau und Download. */
export const GET = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const file = await loadFile(id);
  await requireProjectAccess(ctx, file.project_id);
  pruefeOffertenzugriff(ctx, file);

  const download = new URL(request.url).searchParams.get('download') === '1';

  const { data, error } = await serviceClient()
    .storage.from(STORAGE_BUCKET)
    .createSignedUrl(
      file.storage_path,
      VIEW_URL_TTL,
      download ? { download: file.name } : undefined,
    );

  if (error || !data?.signedUrl) {
    throw new ApiError(
      `Datei konnte nicht geöffnet werden: ${error?.message ?? 'keine URL erhalten'}`,
      500,
    );
  }

  return ok({ url: data.signedUrl, name: file.name, mimeType: file.mime_type });
});

/** Löschen: der Admin alles, ein Lieferant nur eigene Uploads. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const file = await loadFile(id);
  await requireProjectAccess(ctx, file.project_id);
  pruefeOffertenzugriff(ctx, file);

  if (
    ctx.session.kind === 'supplier' &&
    file.uploaded_by_supplier_id !== ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur selbst hochgeladene Dateien löschen.');
  }

  const { error } = await ctx.db.from('files').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  // Erst wenn der Datensatz weg ist, die Objekte im Storage entfernen. Bleibt hier
  // etwas liegen, ist das nur verwaister Speicher – kein sichtbarer Fehler mehr.
  const paths = [file.storage_path, file.thumb_path].filter(
    (p): p is string => Boolean(p),
  );
  const removal = await serviceClient().storage.from(STORAGE_BUCKET).remove(paths);
  if (removal.error) {
    console.error('[storage] Datei nicht entfernt', removal.error);
  }

  return ok({ ok: true });
});
