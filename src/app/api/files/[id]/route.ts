import { ApiError, forbidden, handler, ok, readJson } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { darfOfferteSehen } from '@/lib/auth/offerAccess';
import { logActivity } from '@/lib/activity';
import { ordnerName } from '@/lib/offers';
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
 * Offerten sind vertraulich. Die Datenbank blendet fremde zwar aus, diese Route
 * liest aber bewusst mit Dienstschlüssel – also wird hier noch einmal
 * ausdrücklich geprüft. Erlaubt sind die eigenen und die der eigenen Firma.
 */
async function pruefeOffertenzugriff(ctx: Sitzung, file: Datei) {
  if (!file.offer_folder) return;
  if (await darfOfferteSehen(ctx.session, file.uploaded_by_supplier_id)) return;
  throw new ApiError('Datei nicht gefunden.', 404);
}

/** Kurzlebige Signed URL auf die Originaldatei – für Vorschau und Download. */
export const GET = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const file = await loadFile(id);
  await requireProjectAccess(ctx, file.project_id);
  await pruefeOffertenzugriff(ctx, file);

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

/**
 * Angaben zu einer Offerte pflegen: Betrag und Stand.
 *
 * Den Betrag darf auch der einreichende Lieferant setzen – er kennt ihn. Über
 * den Stand (geprüft, vergeben, abgelehnt) entscheiden wir allein; dieselbe
 * Regel steht als Trigger in Migration 0017.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const file = await loadFile(id);
  await requireProjectAccess(ctx, file.project_id);
  await pruefeOffertenzugriff(ctx, file);

  const body = await readJson<{
    betrag?: number | null;
    stand?: string | null;
    documentFolder?: string | null;
  }>(request);

  const patch: Record<string, unknown> = {};

  if (body.betrag !== undefined) {
    if (
      ctx.session.kind === 'supplier' &&
      file.uploaded_by_supplier_id !== ctx.session.supplierId
    ) {
      throw forbidden('Du kannst nur eigene Einreichungen bearbeiten.');
    }
    if (body.betrag === null) {
      patch.offer_amount = null;
    } else if (typeof body.betrag === 'number' && body.betrag >= 0) {
      patch.offer_amount = Math.round(body.betrag * 100) / 100;
    } else {
      throw new ApiError('Der Betrag muss eine Zahl sein.');
    }
  }

  if (body.stand !== undefined) {
    if (ctx.session.kind !== 'admin') {
      throw forbidden('Über den Stand einer Offerte entscheidet die Swiss Solar Ventures AG.');
    }
    const erlaubt = ['eingereicht', 'geprueft', 'vergeben', 'abgelehnt'];
    if (body.stand !== null && !erlaubt.includes(body.stand)) {
      throw new ApiError('Unbekannter Stand.');
    }
    patch.offer_status = body.stand;
  }

  // Ein Dokument in einen anderen Ordner legen. Verschieben darf, wer die Datei
  // auch löschen dürfte – wir alles, ein Lieferant das Eigene.
  if (body.documentFolder !== undefined) {
    if (
      ctx.session.kind === 'supplier' &&
      file.uploaded_by_supplier_id !== ctx.session.supplierId
    ) {
      throw forbidden('Du kannst nur eigene Dokumente verschieben.');
    }

    if (body.documentFolder === null) {
      patch.document_folder = null;
    } else {
      // Der Zielordner muss zum selben Projekt gehören, sonst verschwände das
      // Dokument in einem Projekt, für das die Person keinen Zugriff hat.
      const ziel = await serviceClient()
        .from('document_folders')
        .select('id')
        .eq('id', body.documentFolder)
        .eq('project_id', file.project_id)
        .maybeSingle();

      if (ziel.error) throw new ApiError('Die Ordner stehen erst nach Migration 0019 zur Verfügung.');
      if (!ziel.data) throw new ApiError('Der Ordner gehört nicht zu diesem Projekt.');
      patch.document_folder = body.documentFolder;
    }
  }

  if (!Object.keys(patch).length) throw new ApiError('Keine Änderung übergeben.');

  // Alten Stand merken, um nur echte Wechsel zu melden. Eigene Abfrage, weil
  // loadFile auch ohne Migration 0017 funktionieren muss.
  let bisherigerStand: string | null = null;
  if (patch.offer_status !== undefined) {
    const { data: vorher } = await serviceClient()
      .from('files')
      .select('offer_status')
      .eq('id', id)
      .maybeSingle();
    bisherigerStand = (vorher as { offer_status: string | null } | null)?.offer_status ?? null;
  }

  const { error } = await ctx.db.from('files').update(patch).eq('id', id);
  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  // Statuswechsel einer Offerte: die einreichende Firma erfährt es sofort –
  // als Benachrichtigung in der Glocke und, sobald eingerichtet, per E-Mail.
  let warning: string | null = null;
  const neuerStand = patch.offer_status as string | null | undefined;

  if (
    file.offer_folder &&
    neuerStand !== undefined &&
    (neuerStand ?? 'eingereicht') !== (bisherigerStand ?? 'eingereicht') &&
    ctx.session.kind === 'admin'
  ) {
    const wortlaut: Record<string, string> = {
      eingereicht: `hat "${file.name}" auf Eingereicht zurückgesetzt`,
      geprueft: `hat "${file.name}" (${ordnerName(file.offer_folder)}) in Prüfung genommen`,
      vergeben: `hat "${file.name}" (${ordnerName(file.offer_folder)}) angenommen 🎉`,
      abgelehnt: `hat "${file.name}" (${ordnerName(file.offer_folder)}) abgelehnt`,
    };
    const zeichen: Record<string, string> = {
      eingereicht: '📑',
      geprueft: '🔍',
      vergeben: '✅',
      abgelehnt: '✕',
    };
    const stand = neuerStand ?? 'eingereicht';

    warning = await logActivity(ctx.db, {
      projectId: file.project_id,
      actorName: ctx.session.name,
      actorEmail: ctx.session.email,
      text: wortlaut[stand],
      icon: zeichen[stand],
      nurFuerSupplierIds: file.uploaded_by_supplier_id
        ? [file.uploaded_by_supplier_id]
        : [],
    });
  }

  return ok({ ok: true, warning });
});

/** Löschen heisst wegwerfen: die Datei wandert in den Papierkorb. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const file = await loadFile(id);
  await requireProjectAccess(ctx, file.project_id);
  await pruefeOffertenzugriff(ctx, file);

  if (
    ctx.session.kind === 'supplier' &&
    file.uploaded_by_supplier_id !== ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur selbst hochgeladene Dateien löschen.');
  }

  const { error } = await ctx.db
    .from('files')
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.session.name })
    .eq('id', id);

  // Ohne Migration 0017 gibt es den Papierkorb noch nicht – dann wie bisher
  // endgültig löschen, samt der Objekte im Speicher.
  if (error) {
    const { error: hart } = await ctx.db.from('files').delete().eq('id', id);
    if (hart) throw new ApiError(`Löschen fehlgeschlagen: ${hart.message}`, 500);

    const paths = [file.storage_path, file.thumb_path].filter(
      (p): p is string => Boolean(p),
    );
    const removal = await serviceClient().storage.from(STORAGE_BUCKET).remove(paths);
    if (removal.error) console.error('[storage] Datei nicht entfernt', removal.error);
  }

  return ok({ ok: true });
});
