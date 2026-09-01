import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { AdminCtx } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Eine Vorlage auf ein Projekt übertragen.
 *
 * Angelegt wird pro Schritt eine Aufgabe mit Kennzeichen, ohne Frist und ohne
 * Zuständige – beides gehört zum einzelnen Bau und wird danach gesetzt.
 *
 * Bereits vorhandene Texte werden übersprungen. Das macht die Übernahme
 * wiederholbar: Wächst die Vorlage später um einen Schritt, lässt sie sich
 * erneut anwenden und ergänzt nur das Fehlende, statt alles zu verdoppeln.
 */
async function uebertragen(
  ctx: AdminCtx,
  projectId: string,
  schritte: string[],
): Promise<number> {
  const { data: vorhanden } = await ctx.db
    .from('todos')
    .select('text')
    .eq('project_id', projectId)
    .is('deleted_at', null);

  const schonDa = new Set(
    ((vorhanden ?? []) as Array<{ text: string }>).map((t) =>
      t.text.trim().toLowerCase(),
    ),
  );

  const fehlend = schritte.filter((s) => !schonDa.has(s.trim().toLowerCase()));
  if (!fehlend.length) return 0;

  // Meilensteine gehören an den Anfang der Liste, deshalb negative Werte: So
  // stehen sie vor allem, was im Projekt schon steht, ohne dass die
  // bestehenden Aufgaben umsortiert werden müssten.
  const { data: erste } = await ctx.db
    .from('todos')
    .select('order_index')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .limit(1)
    .maybeSingle();

  const start = Math.min(0, (erste as { order_index: number } | null)?.order_index ?? 0);

  const zeilen = fehlend.map((text, i) => ({
    project_id: projectId,
    text,
    assigned_to: 'internal',
    created_by: ctx.session.name,
    due_date: null,
    meilenstein: true,
    order_index: start - fehlend.length + i,
  }));

  const { error } = await ctx.db.from('todos').insert(zeilen);
  if (error) throw new ApiError(`Übernahme fehlgeschlagen: ${error.message}`, 500);

  return fehlend.length;
}

/**
 * Übertragen – auf ein Projekt oder auf alle.
 *
 * Bewusst ohne Benachrichtigung: Zwanzig Meilensteine auf fünf Projekten
 * ergäben hundert Mails über Aufgaben, die noch niemandem zugewiesen sind.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ projectId?: string; alle?: boolean }>(request);

  const { data: posten, error } = await ctx.db
    .from('milestone_template_items')
    .select('text, sortierung')
    .eq('template_id', id)
    .order('sortierung', { ascending: true });

  if (error) {
    throw new ApiError(
      `Vorlagen gibt es erst nach der Datenbank-Aktualisierung 0030: ${error.message}`,
      400,
    );
  }

  const schritte = ((posten ?? []) as Array<{ text: string }>).map((p) => p.text);
  if (!schritte.length) throw new ApiError('Diese Vorlage hat keine Schritte.');

  if (body.alle) {
    const { data: projekte } = await ctx.db.from('projects').select('id, name');
    const liste = (projekte ?? []) as Array<{ id: string; name: string }>;

    const ergebnis: Array<{ projekt: string; neu: number }> = [];
    for (const p of liste) {
      ergebnis.push({ projekt: p.name, neu: await uebertragen(ctx, p.id, schritte) });
    }

    return ok({
      projekte: ergebnis.length,
      neu: ergebnis.reduce((s, e) => s + e.neu, 0),
      je: ergebnis,
    });
  }

  const projectId = String(body.projectId ?? '').trim();
  if (!projectId) throw new ApiError('Kein Projekt angegeben.');

  return ok({ projekte: 1, neu: await uebertragen(ctx, projectId, schritte) });
});

/** Vorlage löschen. Die Meilensteine in den Projekten bleiben davon unberührt. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { error } = await ctx.db.from('milestone_templates').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
