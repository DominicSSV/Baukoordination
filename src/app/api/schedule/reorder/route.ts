import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/**
 * Neue Reihenfolge der Zeilen im Terminplan speichern.
 *
 * Der Browser schickt die Arbeiten in der gewünschten Abfolge – Zeile für Zeile,
 * innerhalb einer Zeile nach Beginn. Jede bekommt hier ihre laufende Nummer;
 * die Ansicht sortiert die Gewerke danach.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ order?: unknown }>(request);

  if (!Array.isArray(body.order) || !body.order.length) {
    throw new ApiError('Keine Reihenfolge übergeben.');
  }

  const ids = body.order.filter(
    (id): id is string => typeof id === 'string' && !!id.trim(),
  );
  if (!ids.length) throw new ApiError('Keine gültigen Arbeiten übergeben.');

  for (let i = 0; i < ids.length; i += 1) {
    const { error } = await ctx.db
      .from('schedule_tasks')
      .update({ order_index: i + 1 })
      .eq('id', ids[i]);

    if (error) {
      throw new ApiError(
        `Reihenfolge konnte nicht gespeichert werden: ${error.message}`,
        500,
      );
    }
  }

  return ok({ ok: true });
});
