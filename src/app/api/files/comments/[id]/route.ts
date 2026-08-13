import { ApiError, forbidden, handler, ok } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Eigene Anmerkungen sind löschbar, fremde nur für die Swiss Solar Ventures AG. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: kommentar } = await serviceClient()
    .from('file_comments')
    .select('id, file_id, author_supplier_id')
    .eq('id', id)
    .maybeSingle();

  if (!kommentar) throw new ApiError('Anmerkung nicht gefunden.', 404);

  const { data: datei } = await serviceClient()
    .from('files')
    .select('project_id')
    .eq('id', (kommentar as { file_id: string }).file_id)
    .maybeSingle();

  if (!datei) throw new ApiError('Datei nicht gefunden.', 404);
  await requireProjectAccess(ctx, (datei as { project_id: string }).project_id);

  if (
    ctx.session.kind === 'supplier' &&
    (kommentar as { author_supplier_id: string | null }).author_supplier_id !==
      ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur eigene Anmerkungen löschen.');
  }

  const { error } = await ctx.db.from('file_comments').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
