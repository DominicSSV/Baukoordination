import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { projectIdOfTodo, requireSession } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: todoId } = await params;
  const ctx = await requireSession();
  const projectId = await projectIdOfTodo(ctx, todoId);

  const body = await readJson<{ text?: string }>(request);
  const text = requireString(body.text, 'Kommentar', 2000);

  const { data, error } = await ctx.db
    .from('todo_comments')
    .insert({
      todo_id: todoId,
      text,
      author: ctx.session.name,
      author_supplier_id:
        ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
    })
    .select('id, todo_id, text, author, author_supplier_id, created_at')
    .single();

  if (error) {
    throw new ApiError(`Kommentar konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  const { data: todo } = await serviceClient()
    .from('todos')
    .select('text')
    .eq('id', todoId)
    .maybeSingle();

  const warning = await logActivity(ctx.db, {
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    text: `hat zu To-Do "${todo?.text ?? ''}" kommentiert: "${text}"`,
    icon: '💬',
  });

  return ok({ comment: data, warning }, { status: 201 });
});
