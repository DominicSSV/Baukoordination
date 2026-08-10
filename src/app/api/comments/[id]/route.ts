import { ApiError, forbidden, handler, ok } from '@/lib/api';
import { projectIdOfTodo, requireSession } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Eigene Kommentare sind löschbar, fremde nur für den Admin. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: comment } = await serviceClient()
    .from('todo_comments')
    .select('id, todo_id, author_supplier_id')
    .eq('id', id)
    .maybeSingle();

  if (!comment) throw new ApiError('Kommentar nicht gefunden.', 404);
  await projectIdOfTodo(ctx, comment.todo_id);

  if (
    ctx.session.kind === 'supplier' &&
    comment.author_supplier_id !== ctx.session.supplierId
  ) {
    throw forbidden('Du kannst nur eigene Kommentare löschen.');
  }

  const { error } = await ctx.db.from('todo_comments').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
