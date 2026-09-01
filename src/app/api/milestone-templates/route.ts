import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { MeilensteinVorlage } from '@/types';

export const dynamic = 'force-dynamic';

/** So viele Schritte darf eine Vorlage haben – mehr ist kein Ablauf mehr. */
const MAX_SCHRITTE = 60;

/**
 * Die gespeicherten Schrittfolgen.
 *
 * Nur für uns: Das ist Arbeitsvorbereitung, nicht Baustelleninhalt. Die
 * Meilensteine selbst sehen die Lieferanten sehr wohl – das sind gewöhnliche
 * Aufgaben.
 */
export const GET = handler(async () => {
  const ctx = await requireAdmin();

  const { data, error } = await ctx.db
    .from('milestone_templates')
    .select('id, name, created_at, milestone_template_items(text, sortierung)')
    .order('created_at', { ascending: true });

  // Ohne Migration 0030 gibt es die Tabellen noch nicht.
  if (error) return ok({ vorlagen: [], ohneTabelle: true });

  const zeilen = (data ?? []) as Array<{
    id: string;
    name: string;
    created_at: string;
    milestone_template_items: Array<{ text: string; sortierung: number }>;
  }>;

  const vorlagen: MeilensteinVorlage[] = zeilen.map((z) => ({
    id: z.id,
    name: z.name,
    schritte: [...(z.milestone_template_items ?? [])]
      .sort((a, b) => a.sortierung - b.sortierung)
      .map((p) => p.text),
  }));

  return ok({ vorlagen });
});

/**
 * Eine Vorlage aus einem bestehenden Projekt bilden.
 *
 * Übernommen wird nur der Text der Aufgaben, in ihrer Reihenfolge. Fristen und
 * Zuständige bleiben absichtlich draussen: Sie gehören zum einzelnen Bau. Eine
 * Vorlage mit dem Datum von Berg wäre bei Dietikon von Anfang an falsch.
 *
 * Sind im Projekt schon Meilensteine markiert, werden nur diese genommen –
 * sonst alle offenen und erledigten Aufgaben. So lässt sich eine Vorlage
 * nachschärfen, ohne die Tagesaufgaben mitzuschleppen.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ name?: string; projectId?: string }>(request);
  const name = requireString(body.name, 'Name der Vorlage', 120);
  const projectId = requireString(body.projectId, 'Projekt', 60);

  const { data: aufgaben, error: leseFehler } = await ctx.db
    .from('todos')
    .select('text, order_index, meilenstein')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('order_index', { ascending: true });

  if (leseFehler) {
    throw new ApiError(
      `Vorlagen gibt es erst nach der Datenbank-Aktualisierung 0030: ${leseFehler.message}`,
      400,
    );
  }

  const alle = (aufgaben ?? []) as Array<{
    text: string;
    order_index: number;
    meilenstein: boolean | null;
  }>;

  const markierte = alle.filter((a) => a.meilenstein);
  const quelle = markierte.length ? markierte : alle;

  // Doppelte Texte werfen wir weg: Zweimal "Gerüst stellen" in einer Vorlage
  // ergäbe bei jeder Übernahme zwei identische Zeilen.
  const texte: string[] = [];
  for (const a of quelle) {
    const t = a.text.trim();
    if (t && !texte.includes(t)) texte.push(t);
  }

  if (!texte.length) throw new ApiError('Dieses Projekt hat keine Aufgaben.');
  if (texte.length > MAX_SCHRITTE) {
    throw new ApiError(
      `Das sind ${texte.length} Schritte. Eine Vorlage sollte den Ablauf zeigen, ` +
        `nicht jede Kleinigkeit – höchstens ${MAX_SCHRITTE}.`,
    );
  }

  const { data: vorlage, error } = await ctx.db
    .from('milestone_templates')
    .insert({ name, created_by: ctx.session.name })
    .select('id, name')
    .single();

  if (error || !vorlage) {
    throw new ApiError(`Vorlage konnte nicht angelegt werden: ${error?.message}`, 500);
  }

  const neu = vorlage as { id: string; name: string };

  const { error: posten } = await ctx.db.from('milestone_template_items').insert(
    texte.map((text, i) => ({ template_id: neu.id, text, sortierung: i })),
  );

  if (posten) {
    // Eine Vorlage ohne Schritte wäre wertlos und stünde nur im Weg.
    await ctx.db.from('milestone_templates').delete().eq('id', neu.id);
    throw new ApiError(`Schritte konnten nicht gespeichert werden: ${posten.message}`, 500);
  }

  return ok({ vorlage: { id: neu.id, name: neu.name, schritte: texte } }, { status: 201 });
});
