import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { assigneeDisplayName, resolveAssignee } from '@/lib/auth/assignTarget';
import { logActivity } from '@/lib/activity';
import { fmtDueDate, parseDueDate } from '@/lib/due';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Neue Aufgabe anlegen. Beide Seiten dürfen das – wen sie als Zuständigen wählen
 * dürfen, entscheidet resolveAssignee(), zusätzlich zur RLS-Policy todos_insert.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{
    text?: string;
    assignedTo?: string;
    dueDate?: string | null;
  }>(request);

  const text = requireString(body.text, 'Aufgabe', 1000);
  const assignedTo = await resolveAssignee(ctx.session, projectId, body.assignedTo);
  const dueDate = parseDueDate(body.dueDate);

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
      created_by_supplier_id:
        ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
      due_date: dueDate,
      order_index: (last?.order_index ?? 0) + 1,
    })
    .select(
      'id, project_id, text, assigned_to, done, done_by, done_at, created_by, created_by_supplier_id, created_at, edited_at, order_index, due_date',
    )
    .single();

  if (result.error) {
    throw new ApiError(`Aufgabe konnte nicht angelegt werden: ${result.error.message}`, 500);
  }

  const empfaenger = await assigneeDisplayName(assignedTo);

  const warning = await logActivity(ctx.db, {
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    text:
      `hat To-Do "${text}" für ${empfaenger} angelegt` +
      (dueDate ? ` (zu erledigen bis ${fmtDueDate(dueDate)})` : ''),
    icon: '📝',
  });

  return ok({ todo: { ...result.data, comments: [] }, warning }, { status: 201 });
});
