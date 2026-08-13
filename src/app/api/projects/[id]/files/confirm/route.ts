import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { ordnerName, pruefeOrdner } from '@/lib/offers';
import { betragAusPdf } from '@/lib/server/offerBetrag';
import { STORAGE_BUCKET } from '@/lib/env';
import { beteiligteLieferanten } from '@/lib/beteiligte';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Schritt 2 des Uploads: Nach dem direkten Storage-Upload den Datensatz anlegen.
 *
 * Die vom Browser gemeldeten Pfade werden gegen das erwartete Muster geprüft, damit
 * niemand über diese Route eine fremde Datei aus dem Bucket in sein Projekt hängt.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{
    fileId?: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
    storagePath?: string;
    thumbPath?: string;
    todoId?: string;
    offerFolder?: string;
    betrag?: number | null;
  }>(request);

  const fileId = requireString(body.fileId, 'fileId', 64);
  const name = requireString(body.name, 'Dateiname', 300);
  const storagePath = requireString(body.storagePath, 'storagePath', 500);
  const thumbPath = optionalString(body.thumbPath, 500);
  const todoId = optionalString(body.todoId, 64);
  const offerFolder = pruefeOrdner(body.offerFolder);

  if (body.offerFolder !== undefined && body.offerFolder !== null && !offerFolder) {
    throw new ApiError('Unbekannter Offertenordner.');
  }

  if (!storagePath.startsWith(`${projectId}/${fileId}-`)) {
    throw new ApiError('Der gemeldete Speicherpfad passt nicht zum Projekt.', 400);
  }
  if (thumbPath && thumbPath !== `${projectId}/thumbs/${fileId}.jpg`) {
    throw new ApiError('Der gemeldete Vorschaupfad passt nicht zum Projekt.', 400);
  }

  if (todoId) {
    const { data } = await serviceClient()
      .from('todos')
      .select('id')
      .eq('id', todoId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!data) throw new ApiError('Die Aufgabe gehört nicht zu diesem Projekt.');
  }

  const einfuegen = (zeile: Record<string, unknown>) =>
    ctx.db
      .from('files')
      .insert(zeile)
      .select(
        'id, project_id, todo_id, name, mime_type, size_bytes, uploaded_by, uploaded_by_supplier_id, uploaded_at',
      )
      .single();

  const neueZeile = {
      id: fileId,
      project_id: projectId,
      todo_id: todoId,
      name,
      mime_type: optionalString(body.mimeType, 200) ?? 'application/octet-stream',
      size_bytes:
        typeof body.sizeBytes === 'number' && body.sizeBytes >= 0
          ? Math.round(body.sizeBytes)
          : null,
      storage_path: storagePath,
      thumb_path: thumbPath,
      uploaded_by: ctx.session.name,
      uploaded_by_supplier_id:
        ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
      ...(offerFolder
        ? {
            offer_folder: offerFolder,
            offer_status: 'eingereicht',
            ...(typeof body.betrag === 'number' && body.betrag >= 0
              ? { offer_amount: Math.round(body.betrag * 100) / 100 }
              : {}),
          }
        : {}),
  };

  const erster = await einfuegen(neueZeile);

  // Ohne Migration 0017 gibt es die Statusspalte noch nicht.
  const { data, error } = erster.error
    ? await einfuegen({ ...neueZeile, offer_status: undefined })
    : erster;

  if (error) {
    throw new ApiError(`Datei konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  const isImage = (body.mimeType ?? '').startsWith('image/');
  let where = '';
  // Hängt die Datei an einer vertraulichen Aufgabe, darf auch der
  // Protokolleintrag nur die Beteiligten erreichen.
  let vertraulicheAufgabe: string[] | undefined;

  if (todoId) {
    const { data: todo } = await serviceClient()
      .from('todos')
      .select('text, vertraulich, assignees, assigned_to, created_by_supplier_id')
      .eq('id', todoId)
      .maybeSingle();

    if (todo) {
      where = ` zu To-Do "${todo.text}"`;
      const t = todo as {
        vertraulich?: boolean | null;
        assignees?: string[] | null;
        assigned_to?: string | null;
        created_by_supplier_id?: string | null;
      };
      if (t.vertraulich) vertraulicheAufgabe = beteiligteLieferanten(t);
    }
  }

  // Offerten gehen nur uns und dem einreichenden Lieferanten etwas an – im
  // offenen Protokoll stünde sonst für alle lesbar, wer was eingereicht hat.
  const warning = await logActivity(ctx.db, {
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    text: offerFolder
      ? `hat "${name}" unter ${ordnerName(offerFolder)} eingereicht`
      : `hat ${isImage ? 'Bild' : 'Dokument'} "${name}"${where} hinzugefügt`,
    icon: offerFolder ? '📑' : isImage ? '📷' : '📄',
    nurFuerSupplierIds: offerFolder
      ? [
          ...(data.uploaded_by_supplier_id
            ? [data.uploaded_by_supplier_id as string]
            : []),
        ]
      : vertraulicheAufgabe,
  });

  // Bei Offerten im PDF-Format den Betrag exkl. MwSt. herauslesen. Eine
  // Heuristik – schlägt sie fehl, bleibt das Feld leer und niemand merkt etwas.
  let betragErkannt: number | null = null;
  let betragHinweis: string | null = null;

  // Ein von Hand erfasster Betrag hat Vorrang – dann gar nicht erst suchen.
  const betragVonHand = typeof body.betrag === 'number' && body.betrag >= 0;

  if (!betragVonHand && offerFolder && (body.mimeType ?? '') === 'application/pdf') {
    try {
      const download = await serviceClient()
        .storage.from(STORAGE_BUCKET)
        .download(storagePath);

      if (!download.error && download.data && download.data.size < 15 * 1024 * 1024) {
        const puffer = new Uint8Array(await download.data.arrayBuffer());
        const befund = await betragAusPdf(puffer);
        betragErkannt = befund.betrag;

        if (befund.grund === 'kein-text') {
          betragHinweis =
            'Diese PDF enthält keinen lesbaren Text – sie wurde ohne Zeichentabelle ' +
            'erstellt. Der Betrag muss von Hand eingetragen werden.';
        } else if (befund.grund === 'nicht-gefunden') {
          betragHinweis =
            'Im Text war kein Total exkl. MwSt. zu finden. Bitte den Betrag ' +
            'von Hand eintragen.';
        }

        if (betragErkannt !== null) {
          await ctx.db
            .from('files')
            .update({ offer_amount: betragErkannt })
            .eq('id', fileId)
            .is('offer_amount', null);
        }
      }
    } catch (e) {
      console.warn('[offerten] Betrag nicht auslesbar', e);
    }
  }

  return ok({ file: data, warning, betragErkannt, betragHinweis }, { status: 201 });
});
