import { ApiError, handler, ok } from '@/lib/api';
import { projectIdOfTodo, requireSession } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';
import { signAvatars } from '@/lib/avatars';
import type { AdminProfile, Supplier, TodoComment } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export type AufgabeZumBearbeiten = {
  id: string;
  projectId: string;
  text: string;
  dueDate: string | null;
  assignees: string[];
  vertraulich: boolean;
  meilenstein: boolean;
};

/**
 * Alles, was zum Bearbeiten einer einzelnen Aufgabe gebraucht wird.
 *
 * Für die Übersicht "Meine To-Do's": Dort stehen Aufgaben aus allen Projekten
 * nebeneinander, und wer eine davon ändern will, braucht die Leute des
 * jeweiligen Projekts – nicht die eines gerade geöffneten. Das ganze Projekt
 * nachzuladen wäre dafür zu viel: Dateien, Protokoll und Terminplan hängen
 * daran, und gebraucht wird eine Zeile.
 *
 * Gelesen wird die Aufgabe mit der Sitzung, damit fremde und vertrauliche
 * Aufgaben von der Datenbank selbst ausgeblendet bleiben. Die Namensliste
 * kommt mit dem Dienstschlüssel und fester Spaltenauswahl – Adressen,
 * Telefonnummern und Passwörter verlassen diese Abfrage nie.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  const projectId = await projectIdOfTodo(ctx, id);

  // Jede Migration bringt eine Spalte mehr. Fehlt eine, wird der Reihe nach
  // eine kürzere Auswahl versucht, statt dass das Bearbeiten ganz ausfällt.
  const stufen = [
    'id, project_id, text, due_date, assigned_to, created_by_supplier_id, assignees, vertraulich, meilenstein',
    'id, project_id, text, due_date, assigned_to, created_by_supplier_id, assignees, vertraulich',
    'id, project_id, text, due_date, assigned_to, created_by_supplier_id, assignees',
    'id, project_id, text, due_date, assigned_to, created_by_supplier_id',
  ];

  let zeile: Record<string, unknown> | null = null;
  let letzterFehler = '';

  for (const spalten of stufen) {
    const versuch = await ctx.db
      .from('todos')
      .select(spalten)
      .eq('id', id)
      .maybeSingle();

    if (!versuch.error) {
      zeile = versuch.data as unknown as Record<string, unknown> | null;
      break;
    }
    letzterFehler = versuch.error.message;
  }

  if (!zeile) {
    throw new ApiError(
      letzterFehler ? `Aufgabe: ${letzterFehler}` : 'Aufgabe nicht gefunden.',
      letzterFehler ? 500 : 404,
    );
  }

  const assignees = Array.isArray(zeile.assignees) && (zeile.assignees as string[]).length
    ? (zeile.assignees as string[])
    : [String(zeile.assigned_to ?? '')].filter(Boolean);

  const aufgabe: AufgabeZumBearbeiten = {
    id: String(zeile.id),
    projectId,
    text: String(zeile.text ?? ''),
    dueDate: (zeile.due_date as string | null) ?? null,
    assignees,
    vertraulich: zeile.vertraulich === true,
    meilenstein: zeile.meilenstein === true,
  };

  const dienst = serviceClient();
  const istAdmin = ctx.session.kind === 'admin';

  const [kommentare, adminRes, zugriff] = await Promise.all([
    ctx.db
      .from('todo_comments')
      .select('id, todo_id, text, author, author_supplier_id, created_at')
      .eq('todo_id', id)
      .order('created_at', { ascending: true }),
    dienst.from('admins').select('user_id, name, firma, funktion, avatar_path'),
    // Nur wir dürfen Lieferanten zuweisen – ein Lieferant bekommt die Liste
    // der anderen Firmen am Projekt hier gar nicht erst zu sehen.
    istAdmin
      ? dienst.from('project_access').select('supplier_id').eq('project_id', projectId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const adminZeilen = (adminRes.error ? [] : (adminRes.data ?? [])) as Array<{
    user_id: string;
    name: string | null;
    firma: string | null;
    funktion: string | null;
    avatar_path: string | null;
  }>;

  const supplierIds = (
    (zugriff.error ? [] : (zugriff.data ?? [])) as Array<{ supplier_id: string }>
  ).map((z) => z.supplier_id);

  const supplierRes = supplierIds.length
    ? await dienst
        .from('suppliers')
        .select('id, name, firma, gewerk, avatar_path')
        .in('id', supplierIds)
    : { data: [], error: null };

  const supplierZeilen = (supplierRes.error ? [] : (supplierRes.data ?? [])) as Array<{
    id: string;
    name: string | null;
    firma: string | null;
    gewerk: string | null;
    avatar_path: string | null;
  }>;

  const bilder = await signAvatars([
    ...adminZeilen.map((a) => a.avatar_path),
    ...supplierZeilen.map((z) => z.avatar_path),
  ]);

  const admins: AdminProfile[] = adminZeilen.map((a) => ({
    user_id: a.user_id,
    name: a.name ?? '',
    firma: a.firma ?? '',
    funktion: a.funktion,
    avatar_url: a.avatar_path ? (bilder.get(a.avatar_path) ?? null) : null,
  }));

  const suppliers = supplierZeilen.map((z) => ({
    id: z.id,
    name: z.name ?? '',
    firma: z.firma ?? '',
    gewerk: z.gewerk ?? '',
    avatar_url: z.avatar_path ? (bilder.get(z.avatar_path) ?? null) : null,
  })) as unknown as Supplier[];

  const comments = (
    kommentare.error ? [] : (kommentare.data ?? [])
  ) as unknown as Array<Omit<TodoComment, 'kudos'>>;

  return ok({
    aufgabe,
    admins,
    suppliers,
    // Die Daumen bleiben dem Projekt vorbehalten: In der Übersicht geht es
    // ums Erledigen, nicht ums Zustimmen.
    comments: comments.map((c) => ({ ...c, kudos: [] })) as TodoComment[],
    /**
     * Dieselbe Regel, die der Server ohnehin erzwingt: Wir ändern alles, ein
     * Lieferant nur, was er selbst angelegt hat. Sie steht hier bloss, damit
     * die Ansicht keine Felder zeigt, deren Speichern hinterher abgewiesen
     * würde – ein ausgeblendetes Feld ist kein Schloss.
     */
    darfBearbeiten:
      istAdmin ||
      (ctx.session.kind === 'supplier' &&
        zeile.created_by_supplier_id === ctx.session.supplierId),
  });
});
