import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { saubereTage } from '@/lib/tage';
import type { ProjektKontakt } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN = 'id, rolle, name, firma, telefon, email, notiz, tage, sortierung';
/** Ohne Migration 0032 gibt es die Anwesenheitstage noch nicht. */
const SPALTEN_OHNE_TAGE = 'id, rolle, name, firma, telefon, email, notiz, sortierung';

/** Fehlt die Spalte, kommt tage als undefined zurück – die App will immer eine Liste. */
function mitTagen(zeile: unknown): ProjektKontakt {
  const k = zeile as ProjektKontakt & { tage?: number[] | null };
  return { ...k, tage: saubereTage(k.tage) };
}

/**
 * Die Leute am Bau, die nicht in der App sind: Hauswart, Verwaltung, Bauherr,
 * Ansprechperson vor Ort.
 *
 * Sehen darf sie jeder mit Zugriff auf das Projekt – auch die Lieferanten, für
 * die sie ja gedacht sind. Wer auf der Baustelle vor verschlossener Tür steht,
 * braucht die Nummer des Hauswarts, nicht eine Rückfrage bei uns.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const laden = (spalten: string) =>
    ctx.db
      .from('project_contacts')
      .select(spalten)
      .eq('project_id', projectId)
      .order('sortierung', { ascending: true })
      .order('created_at', { ascending: true });

  const mitSpalte = await laden(SPALTEN);

  // Zwei Stufen zurück: Ohne Migration 0032 fehlen nur die Tage, ohne 0029 die
  // ganze Tabelle. Beides darf das Register nicht mit einer Fehlermeldung
  // anhalten – die Kontakte sind wichtiger als die Anwesenheit.
  const res = mitSpalte.error ? await laden(SPALTEN_OHNE_TAGE) : mitSpalte;
  if (res.error) return ok({ kontakte: [], ohneTabelle: true });

  return ok({
    kontakte: (res.data ?? []).map(mitTagen),
    ohneTage: Boolean(mitSpalte.error),
  });
});

/** Anlegen darf jeder mit Zugriff auf das Projekt – auch die Lieferanten. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  // Wer vor Ort ist, kennt die Nummer des Hauswarts oft zuerst. Die Datenbank
  // prüft dasselbe ein zweites Mal über die RLS-Regel.
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{
    rolle?: string;
    name?: string;
    firma?: string;
    telefon?: string;
    email?: string;
    notiz?: string;
    tage?: unknown;
  }>(request);

  const rolle = requireString(body.rolle, 'Funktion', 120);

  // Ans Ende der Liste. Die Reihenfolge steht bewusst nicht alphabetisch fest:
  // Der wichtigste Kontakt gehört nach oben, und wer das ist, weiss nur ihr.
  const { data: letzte } = await ctx.db
    .from('project_contacts')
    .select('sortierung')
    .eq('project_id', projectId)
    .order('sortierung', { ascending: false })
    .limit(1)
    .maybeSingle();

  const felder = {
    project_id: projectId,
    rolle,
    name: optionalString(body.name, 200),
    firma: optionalString(body.firma, 200),
    telefon: optionalString(body.telefon, 60),
    email: optionalString(body.email, 200),
    notiz: optionalString(body.notiz, 500),
    sortierung: ((letzte as { sortierung: number } | null)?.sortierung ?? 0) + 1,
    created_by: ctx.session.name,
  };

  const tage = saubereTage(body.tage);

  const mitSpalte = await ctx.db
    .from('project_contacts')
    .insert({ ...felder, tage })
    .select(SPALTEN)
    .single();

  // Ohne Migration 0032 wird der Kontakt trotzdem angelegt – nur ohne Tage.
  // Ein Hauswart ohne Anwesenheitsangabe ist immer noch ein Hauswart.
  const { data, error } = mitSpalte.error
    ? await ctx.db
        .from('project_contacts')
        .insert(felder)
        .select(SPALTEN_OHNE_TAGE)
        .single()
    : mitSpalte;

  if (error) {
    throw new ApiError(
      `Kontakte je Projekt gibt es erst nach der Datenbank-Aktualisierung 0029: ${error.message}`,
      400,
    );
  }

  return ok(
    { kontakt: mitTagen(data), ohneTage: Boolean(mitSpalte.error) },
    { status: 201 },
  );
});
