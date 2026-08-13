import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/**
 * Neue Reihenfolge der Projekte speichern.
 *
 * Der Browser schickt die IDs in der gewünschten Abfolge; hier bekommt jede ihre
 * laufende Nummer. Optional wandert ein Projekt dabei in eine andere Gruppe –
 * das passiert, wenn man es in eine andere Statusliste zieht.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{
    order?: unknown;
    status?: Record<string, string>;
  }>(request);

  if (!Array.isArray(body.order) || !body.order.length) {
    throw new ApiError('Keine Reihenfolge übergeben.');
  }

  const ids = body.order.filter(
    (id): id is string => typeof id === 'string' && !!id.trim(),
  );
  if (!ids.length) throw new ApiError('Keine gültigen Projekte übergeben.');

  const erlaubt = ['planung', 'umsetzung', 'abschluss', 'abgeschlossen'];

  for (let i = 0; i < ids.length; i += 1) {
    const patch: Record<string, unknown> = { order_index: i + 1 };

    const neuerStatus = body.status?.[ids[i]];
    if (neuerStatus !== undefined) {
      if (!erlaubt.includes(neuerStatus)) {
        throw new ApiError('Unbekannter Projektstatus.');
      }
      patch.status = neuerStatus;
    }

    const { error } = await ctx.db.from('projects').update(patch).eq('id', ids[i]);
    if (error) {
      throw new ApiError(`Reihenfolge konnte nicht gespeichert werden: ${error.message}`, 500);
    }
  }

  return ok({ ok: true });
});
