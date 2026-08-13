import { ApiError, handler, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { adminAssignee, parseAssignee, supplierAssignee } from '@/lib/assignee';

export const dynamic = 'force-dynamic';

/** Mehr als das braucht eine Übersicht nicht – sonst wird sie unlesbar. */
const ANZAHL = 300;

export type MeineAufgabe = {
  id: string;
  projectId: string;
  projectName: string;
  text: string;
  dueDate: string | null;
  assignees: string[];
  /** true = mir persönlich zugewiesen, nicht bloss meiner Firma. */
  meine: boolean;
  createdBy: string;
};

/**
 * Offene Aufgaben aus allen Projekten, auf die man Zugriff hat.
 *
 * Gelesen wird mit der Sitzung: fremde Projekte und Aufgaben, die einen nichts
 * angehen, blendet die Datenbank selbst aus (Migrationen 0014/0015). Erledigtes
 * bleibt draussen – die Übersicht beantwortet die Frage „was steht an", nicht
 * „was war".
 */
export const GET = handler(async () => {
  const ctx = await requireSession();

  const spalten =
    'id, project_id, text, assigned_to, assignees, due_date, created_by, projects(name)';

  const mitListe = await ctx.db
    .from('todos')
    .select(spalten)
    .eq('done', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(ANZAHL);

  // Ohne Migration 0014 gibt es die Spalte assignees noch nicht.
  const { data, error } = mitListe.error
    ? await ctx.db
        .from('todos')
        .select('id, project_id, text, assigned_to, due_date, created_by, projects(name)')
        .eq('done', false)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(ANZAHL)
    : mitListe;

  if (error) throw new ApiError(`Aufgaben: ${error.message}`, 500);

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    project_id: string;
    text: string;
    assigned_to: string;
    assignees?: string[] | null;
    due_date: string | null;
    created_by: string;
    projects: { name: string } | null;
  }>;

  // Der eigene Zuständigkeitswert – damit lässt sich "meine" von "aus meiner
  // Firma" unterscheiden.
  const ich =
    ctx.session.kind === 'admin'
      ? adminAssignee(ctx.session.userId)
      : supplierAssignee(ctx.session.supplierId);

  const aufgaben: MeineAufgabe[] = rows.map((r) => {
    const assignees = r.assignees?.length ? r.assignees : [r.assigned_to];

    return {
      id: r.id,
      projectId: r.project_id,
      projectName: r.projects?.name ?? 'Projekt',
      text: r.text,
      dueDate: r.due_date,
      assignees,
      meine:
        assignees.includes(ich) ||
        // Eine Aufgabe an die Firma allgemein geht uns alle etwas an.
        (ctx.session.kind === 'admin' &&
          assignees.some((a) => parseAssignee(a).kind === 'internal')),
      createdBy: r.created_by,
    };
  });

  return ok({ aufgaben });
});
