import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { darfOfferteSehen } from '@/lib/auth/offerAccess';
import { logActivity } from '@/lib/activity';
import { ordnerName } from '@/lib/offers';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Anmerkung zu einer Datei schreiben – gedacht für die Offerten.
 *
 * Schreiben darf, wer die Datei auch sehen darf: wir und die Firma, die sie
 * eingereicht hat. Die Prüfung steht hier zusätzlich zur Regel in der Datenbank,
 * weil diese Route die Datei bewusst mit dem Dienstschlüssel liest.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: fileId } = await params;
  const ctx = await requireSession();

  const { data: datei } = await serviceClient()
    .from('files')
    .select('id, project_id, name, offer_folder, uploaded_by_supplier_id')
    .eq('id', fileId)
    .maybeSingle();

  if (!datei) throw new ApiError('Datei nicht gefunden.', 404);

  const file = datei as {
    project_id: string;
    name: string;
    offer_folder: string | null;
    uploaded_by_supplier_id: string | null;
  };

  await requireProjectAccess(ctx, file.project_id);

  if (file.offer_folder && !(await darfOfferteSehen(ctx.session, file.uploaded_by_supplier_id))) {
    throw new ApiError('Datei nicht gefunden.', 404);
  }

  const body = await readJson<{ text?: string }>(request);
  const text = requireString(body.text, 'Anmerkung', 2000);

  const { data, error } = await ctx.db
    .from('file_comments')
    .insert({
      file_id: fileId,
      text,
      author: ctx.session.name,
      author_supplier_id:
        ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
    })
    .select('id, file_id, text, author, author_supplier_id, created_at')
    .single();

  if (error) {
    throw new ApiError(`Anmerkung konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  // Zu einer Offerte geht die Anmerkung nur uns und der einreichenden Firma
  // etwas an – wie die Offerte selbst.
  const warning = await logActivity(ctx.db, {
    projectId: file.project_id,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    text: file.offer_folder
      ? `hat zu "${file.name}" (${ordnerName(file.offer_folder)}) angemerkt: "${text}"`
      : `hat zu "${file.name}" angemerkt: "${text}"`,
    icon: '💬',
    ...(file.offer_folder
      ? {
          nurFuerSupplierIds: file.uploaded_by_supplier_id
            ? [file.uploaded_by_supplier_id]
            : [],
        }
      : {}),
  });

  return ok({ comment: data, warning }, { status: 201 });
});
