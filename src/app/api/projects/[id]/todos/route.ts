import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Neue Aufgabe anlegen – laut Spezifikation ausschliesslich durch den Admin. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ text?: string; assignedTo?: string }>(request);
  const text = requireString(body.text, 'Aufgabe', 1000);
  const assignedTo = (body.assignedTo ?? 'internal').trim() || 'internal';

  // Zuweisung nur an "intern" oder an einen Lieferanten mit Zugriff auf dieses Projekt.
  if (assignedTo !== 'internal') {
    const { data } = await serviceClient()
      .from('project_access')
      .select('supplier_id')
      .eq('project_id', projectId)
      .eq('supplier_id', assignedTo)
      .maybeSingle();

    if (!data) {
      throw new ApiError(
        'Dieser Lieferant hat keinen Zugriff auf das Projekt und kann keine Aufgabe erhalten.',
      );
    }
  }

  // Neue Aufgaben landen unten – die Reihenfolge ändert der Admin per Pfeiltasten.
  const { data: last } = await ctx.db
    .from('todos')
    .select('order_index')
    .eq('project_id', projectId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  const result = await ctx.db
    .from('todos')
    .insert({
      project_id: projectId,
      text,
      assigned_to: assignedTo,
      created_by: ctx.session.name,
      order_index: (last?.order_index ?? 0) + 1,
    })
    .select(
      'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index',
    )
    .single();

  if (result.error) {
    throw new ApiError(`Aufgabe konnte nicht angelegt werden: ${result.error.message}`, 500);
  }

  return ok({ todo: { ...result.data, comments: [] } }, { status: 201 });
});
