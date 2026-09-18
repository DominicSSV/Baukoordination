import { ApiError, handler, ok, readJson } from '@/lib/api';
import {
  projectIdOfTodo,
  requireProjectAccess,
  requireSession,
} from '@/lib/auth/guards';
import { adminAssignee, supplierAssignee } from '@/lib/assignee';
import { logActivity } from '@/lib/activity';
import { beteiligteLieferanten } from '@/lib/beteiligte';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Daumen hoch auf einen Kommentar – setzen oder zurücknehmen.
 *
 * Auf der Baustelle braucht es oft keine Antwort, sondern nur ein Zeichen:
 * gesehen, einverstanden, macht so. Wer dafür "ok" schreiben muss, schreibt es
 * nicht – und der Fragende wartet weiter.
 *
 * Ein zweiter Klick nimmt den Daumen zurück. Ohne das bliebe ein versehentlich
 * gesetzter für immer stehen, und ein Zeichen, das man nicht zurücknehmen kann,
 * setzt man beim zweiten Mal nicht mehr.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: commentId } = await params;
  const ctx = await requireSession();

  const body = await readJson<{ art?: string }>(request);
  const art = body.art === 'datei' ? 'datei' : 'todo';

  const db = serviceClient();

  /**
   * Zuerst den Kommentar suchen und den Zugriff prüfen.
   *
   * Die Tabelle der Daumen hat bewusst keine eigene RLS-Regel: Ob jemand einen
   * Kommentar sehen darf, ist beim Kommentar geregelt. Also muss die Prüfung
   * hier stattfinden, bevor überhaupt etwas geschrieben wird.
   */
  let projectId: string;
  let autorSupplierId: string | null = null;
  let kommentarText = '';
  let bezugText = '';
  let todoBezug: {
    assignees?: string[] | null;
    assigned_to?: string | null;
    created_by_supplier_id?: string | null;
  } | null = null;

  if (art === 'todo') {
    const { data: kommentar } = await db
      .from('todo_comments')
      .select('id, todo_id, text, author_supplier_id')
      .eq('id', commentId)
      .maybeSingle();

    if (!kommentar) throw new ApiError('Kommentar nicht gefunden.', 404);
    projectId = await projectIdOfTodo(ctx, kommentar.todo_id);
    autorSupplierId = kommentar.author_supplier_id;
    kommentarText = kommentar.text;

    const { data: todo } = await db
      .from('todos')
      .select('text, assignees, assigned_to, created_by_supplier_id')
      .eq('id', kommentar.todo_id)
      .maybeSingle();

    bezugText = (todo as { text?: string } | null)?.text ?? '';
    todoBezug = todo as typeof todoBezug;
  } else {
    const { data: kommentar } = await db
      .from('file_comments')
      .select('id, file_id, text, author_supplier_id')
      .eq('id', commentId)
      .maybeSingle();

    if (!kommentar) throw new ApiError('Anmerkung nicht gefunden.', 404);

    const { data: datei } = await db
      .from('files')
      .select('project_id, name')
      .eq('id', kommentar.file_id)
      .maybeSingle();

    if (!datei) throw new ApiError('Datei nicht gefunden.', 404);

    // Wirft, wenn die Person das Projekt nicht sehen darf.
    await requireProjectAccess(ctx, (datei as { project_id: string }).project_id);

    projectId = (datei as { project_id: string }).project_id;
    autorSupplierId = kommentar.author_supplier_id;
    kommentarText = kommentar.text;
    bezugText = (datei as { name: string }).name;
  }

  const wer =
    ctx.session.kind === 'admin'
      ? adminAssignee(ctx.session.userId)
      : supplierAssignee(ctx.session.supplierId);

  const { data: vorhanden } = await db
    .from('comment_kudos')
    .select('id')
    .eq('comment_id', commentId)
    .eq('art', art)
    .eq('wer', wer)
    .maybeSingle();

  if (vorhanden) {
    const { error } = await db
      .from('comment_kudos')
      .delete()
      .eq('id', (vorhanden as { id: string }).id);

    if (error) throw new ApiError(`Zurücknehmen fehlgeschlagen: ${error.message}`, 500);
    return ok({ gesetzt: false });
  }

  const { error } = await db
    .from('comment_kudos')
    .insert({ comment_id: commentId, art, wer, name: ctx.session.name });

  if (error) {
    throw new ApiError(
      'Daumen hoch gibt es erst nach der Datenbank-Aktualisierung 0036: '
        + error.message,
      400,
    );
  }

  /**
   * Der Verfasser soll es erfahren – dafür ist das Zeichen ja da.
   *
   * Der Verteiler folgt derselben Regel wie beim Kommentar selbst: die
   * Zuständigen der Aufgabe und die dem Projekt zugeteilten von uns. Wer den
   * Daumen setzt, fällt als Auslöser ohnehin heraus.
   *
   * Bei einer Datei-Anmerkung gibt es keine Zuständigen; dann geht die Meldung
   * an den Verfasser und uns.
   */
  const kurz =
    kommentarText.length > 60 ? `${kommentarText.slice(0, 60)}…` : kommentarText;

  const warning = await logActivity(ctx.db, {
    notify: true,
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.kind === 'admin' ? ctx.session.email : null,
    actorSupplierId:
      ctx.session.kind === 'supplier' ? ctx.session.supplierId : null,
    text:
      art === 'todo'
        ? `hat den Kommentar zu "${bezugText}" bestätigt: 👍 "${kurz}"`
        : `hat die Anmerkung zu "${bezugText}" bestätigt: 👍 "${kurz}"`,
    icon: '👍',
    empfaengerSupplierIds: todoBezug
      ? Array.from(
          new Set([
            ...beteiligteLieferanten(todoBezug),
            ...(autorSupplierId ? [autorSupplierId] : []),
          ]),
        )
      : autorSupplierId
        ? [autorSupplierId]
        : [],
  });

  return ok({ gesetzt: true, warning });
});
