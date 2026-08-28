import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import type { ProjektKontakt } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN = 'id, rolle, name, firma, telefon, email, notiz, sortierung';

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

  const { data, error } = await ctx.db
    .from('project_contacts')
    .select(SPALTEN)
    .eq('project_id', projectId)
    .order('sortierung', { ascending: true })
    .order('created_at', { ascending: true });

  // Ohne Migration 0029 gibt es die Tabelle noch nicht. Dann bleibt die Liste
  // leer, statt dass das ganze Register mit einer Fehlermeldung stehen bleibt.
  if (error) return ok({ kontakte: [], ohneTabelle: true });

  return ok({ kontakte: (data ?? []) as ProjektKontakt[] });
});

/** Anlegen – wie beim Terminplan pflegt das allein die Swiss Solar Ventures AG. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    rolle?: string;
    name?: string;
    firma?: string;
    telefon?: string;
    email?: string;
    notiz?: string;
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

  const { data, error } = await ctx.db
    .from('project_contacts')
    .insert({
      project_id: projectId,
      rolle,
      name: optionalString(body.name, 200),
      firma: optionalString(body.firma, 200),
      telefon: optionalString(body.telefon, 60),
      email: optionalString(body.email, 200),
      notiz: optionalString(body.notiz, 500),
      sortierung: ((letzte as { sortierung: number } | null)?.sortierung ?? 0) + 1,
      created_by: ctx.session.name,
    })
    .select(SPALTEN)
    .single();

  if (error) {
    throw new ApiError(
      `Kontakte je Projekt gibt es erst nach der Datenbank-Aktualisierung 0029: ${error.message}`,
      400,
    );
  }

  return ok({ kontakt: data as ProjektKontakt }, { status: 201 });
});
