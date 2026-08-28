import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import type { ProjektInfo } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN = 'id, titel, text, sortierung';

/**
 * Angaben zum Objekt: Zugang, Standort, Parkieren, Besonderheiten.
 *
 * Sehen dürfen sie alle Beteiligten – ohne den Zugangscode zur Tiefgarage
 * steht der Elektriker vor dem Tor. Pflegen darf sie nur die Swiss Solar
 * Ventures AG.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const { data, error } = await ctx.db
    .from('project_infos')
    .select(SPALTEN)
    .eq('project_id', projectId)
    .order('sortierung', { ascending: true })
    .order('created_at', { ascending: true });

  // Ohne Migration 0029 gibt es die Tabelle noch nicht – dann bleibt die Liste
  // leer, statt dass das ganze Register mit einer Fehlermeldung stehen bleibt.
  if (error) return ok({ infos: [], ohneTabelle: true });

  return ok({ infos: (data ?? []) as ProjektInfo[] });
});

export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ titel?: string; text?: string }>(request);
  const titel = requireString(body.titel, 'Titel', 120);

  const { data: letzte } = await ctx.db
    .from('project_infos')
    .select('sortierung')
    .eq('project_id', projectId)
    .order('sortierung', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.db
    .from('project_infos')
    .insert({
      project_id: projectId,
      titel,
      text: optionalString(body.text, 2000),
      sortierung: ((letzte as { sortierung: number } | null)?.sortierung ?? 0) + 1,
      created_by: ctx.session.name,
    })
    .select(SPALTEN)
    .single();

  if (error) {
    throw new ApiError(
      `Projektinformationen gibt es erst nach der Datenbank-Aktualisierung 0029: ${error.message}`,
      400,
    );
  }

  return ok({ info: data as ProjektInfo }, { status: 201 });
});
