import { ApiError, handler, ok } from '@/lib/api';
import { requireAdmin, requireProjectAccess } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Einen Zeiteintrag löschen.
 *
 * Geprüft wird auch hier der Projektzugriff, nicht nur die Adminrolle: Sonst
 * könnte ein Eintrag eines Projekts gelöscht werden, das die Person gar nicht
 * betreut.
 */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const db = serviceClient();
  const { data } = await db
    .from('time_entries')
    .select('project_id')
    .eq('id', id)
    .maybeSingle();

  if (!data) throw new ApiError('Diesen Eintrag gibt es nicht.', 404);
  await requireProjectAccess(ctx, (data as { project_id: string }).project_id);

  const { error } = await db.from('time_entries').delete().eq('id', id);
  if (error) throw new ApiError(`Nicht gelöscht: ${error.message}`, 500);

  return ok({ ok: true });
});
