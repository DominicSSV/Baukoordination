import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/** Höchstgrenze pro Aufruf, damit ein Versehen nicht das halbe Protokoll räumt. */
const MAX = 200;

/**
 * Mehrere Protokolleinträge auf einmal löschen. Wie beim einzelnen Eintrag der
 * Swiss Solar Ventures AG vorbehalten; die Datenbank setzt dieselbe Sperre.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();
  const body = await readJson<{ ids?: unknown }>(request);

  if (!Array.isArray(body.ids) || !body.ids.length) {
    throw new ApiError('Es wurde kein Eintrag ausgewählt.');
  }

  const ids = Array.from(
    new Set(body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim())),
  );

  if (!ids.length) throw new ApiError('Es wurde kein gültiger Eintrag übergeben.');
  if (ids.length > MAX) {
    throw new ApiError(`Bitte höchstens ${MAX} Einträge auf einmal löschen.`);
  }

  const { error, count } = await ctx.db
    .from('activity')
    .delete({ count: 'exact' })
    .in('id', ids);

  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ deleted: count ?? ids.length });
});
