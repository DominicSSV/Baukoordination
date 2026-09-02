import {
  ApiError,
  handler,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { Project } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Legt ein neues Projekt nach dem Vorbild eines bestehenden an.
 *
 * Übernommen werden auf Wunsch die Aufgabenliste und die Lieferanten-Freigaben –
 * das ist der Fall, für den man dupliziert: dieselbe Mannschaft, dieselbe Checkliste,
 * neue Baustelle. Bewusst NICHT übernommen werden Kommentare, Dateien und das
 * Aktivitätsprotokoll; sie gehören zum alten Bauvorhaben und würden im neuen
 * Projekt eine Vorgeschichte vortäuschen, die es nicht gibt.
 *
 * Kopierte Aufgaben starten offen, unabhängig davon ob sie im Original erledigt sind.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: sourceId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    name?: string;
    ort?: string;
    withTodos?: boolean;
    withAccess?: boolean;
  }>(request);

  const name = requireString(body.name, 'Projektname', 200);
  const withTodos = body.withTodos !== false;
  const withAccess = body.withAccess !== false;

  const { data: source } = await ctx.db
    .from('projects')
    .select('id, name, ort')
    .eq('id', sourceId)
    .maybeSingle();

  if (!source) throw new ApiError('Vorlage-Projekt nicht gefunden.', 404);

  const created = await ctx.db
    .from('projects')
    .insert({
      name,
      ort: body.ort === undefined ? source.ort : optionalString(body.ort, 200),
    })
    .select('id, name, ort, created_at')
    .single();

  if (created.error) {
    throw new ApiError(`Projekt konnte nicht angelegt werden: ${created.error.message}`, 500);
  }

  const project = created.data as Project;
  const hinweise: string[] = [];

  if (withAccess) {
    const { data: access } = await ctx.db
      .from('project_access')
      .select('supplier_id')
      .eq('project_id', sourceId);

    const rows = (access ?? []).map((r: { supplier_id: string }) => ({
      project_id: project.id,
      supplier_id: r.supplier_id,
    }));

    if (rows.length) {
      const { error } = await ctx.db.from('project_access').insert(rows);
      if (error) {
        hinweise.push(`Freigaben nicht übernommen: ${error.message}`);
      } else {
        await ctx.db.from('access_audit').insert(
          rows.map((r) => ({
            project_id: project.id,
            supplier_id: r.supplier_id,
            action: 'grant',
            actor: ctx.session.name,
            detail: `beim Duplizieren von "${source.name}"`,
          })),
        );
      }
    }
  }

  if (withTodos) {
    const { data: todos } = await ctx.db
      .from('todos')
      .select('text, assigned_to, order_index, created_at')
      .eq('project_id', sourceId)
      // Was im Papierkorb liegt, wollte jemand loswerden. Es in ein neues
      // Projekt mitzukopieren hiesse, es wieder auferstehen zu lassen.
      .is('deleted_at', null)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    const rows = (todos ?? []).map(
      (t: { text: string; assigned_to: string }, index: number) => ({
        project_id: project.id,
        text: t.text,
        // Zuweisungen an Personen der Swiss Solar Ventures AG bleiben bestehen.
        // Zuweisungen an Lieferanten nur dann, wenn diese im neuen Projekt auch
        // freigegeben sind – sonst stünde dort ein Zuständiger ohne Zugriff.
        assigned_to:
          !withAccess && t.assigned_to.startsWith('supplier:')
            ? 'internal'
            : t.assigned_to,
        created_by: ctx.session.name,
        order_index: index + 1,
      }),
    );

    if (rows.length) {
      const { error } = await ctx.db.from('todos').insert(rows);
      if (error) hinweise.push(`Aufgaben nicht übernommen: ${error.message}`);
    }
  }

  return ok({ project, hinweise }, { status: 201 });
});
