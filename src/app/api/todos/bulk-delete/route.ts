import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/** Auf einen Schlag höchstens so viele – der Rest ist ein zweiter Durchgang. */
const MAX = 300;

/**
 * Mehrere Aufgaben auf einmal wegwerfen.
 *
 * Wie beim einzelnen Löschen landen sie im Papierkorb und nicht im Nichts –
 * gerade hier: Wer zweihundert Zeilen auf einmal anwählt, klickt sich auch mal
 * eine zu viel dazu.
 *
 * Nur für uns. Ein Lieferant darf einzelne selbst erstellte Aufgaben löschen;
 * das ist ein anderer Vorgang, und ihn hier nachzubauen hiesse, die Prüfung
 * "gehört mir" für jede Zeile einzeln zu wiederholen. Für den Zweck – nach
 * einer Übernahme aufräumen – braucht es das nicht.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ ids?: string[] }>(request);
  const ids = Array.isArray(body.ids)
    ? Array.from(new Set(body.ids.filter((i) => typeof i === 'string' && i.trim())))
    : [];

  if (!ids.length) throw new ApiError('Keine Aufgaben ausgewählt.');
  if (ids.length > MAX) {
    throw new ApiError(`Höchstens ${MAX} auf einmal – bitte in zwei Schritten.`);
  }

  // Wegwerfen statt löschen: die Aufgaben liegen 30 Tage im Papierkorb.
  const { data, error } = await ctx.db
    .from('todos')
    .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.session.name })
    .in('id', ids)
    .select('id');

  // Ohne Migration 0017 gibt es den Papierkorb noch nicht.
  if (error) {
    const hart = await ctx.db.from('todos').delete().in('id', ids).select('id');
    if (hart.error) {
      throw new ApiError(`Löschen fehlgeschlagen: ${hart.error.message}`, 500);
    }
    return ok({ anzahl: (hart.data ?? []).length, papierkorb: false });
  }

  return ok({ anzahl: (data ?? []).length, papierkorb: true });
});
