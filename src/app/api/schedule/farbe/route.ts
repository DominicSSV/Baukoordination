import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { pruefeFarbe } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

/**
 * Alle Arbeiten einer Zeile auf dieselbe Farbe setzen.
 *
 * Einzeln über /api/schedule/<id> ginge es auch, wären aber so viele Anfragen
 * wie Balken – und bei halbem Durchlauf hätte die Zeile zwei Farben. Hier ist
 * es eine Anfrage, und die Prüfung der Farbe passiert an einer Stelle.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ ids?: unknown; color?: string }>(request);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : [];

  if (!ids.length) throw new ApiError('Keine Arbeiten übergeben.');

  // Der Wert landet direkt als Stil in der Ansicht, dort darf nichts anderes
  // hineinkommen. pruefeFarbe würde bei Unfug still auf Grün ausweichen – hier
  // ist eine klare Absage besser als eine überraschend grüne Zeile.
  if (typeof body.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(body.color.trim())) {
    throw new ApiError('Unbekannte Farbe.');
  }
  const color = pruefeFarbe(body.color);

  const { error } = await ctx.db
    .from('schedule_tasks')
    .update({ color })
    .in('id', ids);

  if (error) {
    throw new ApiError(`Farbe konnte nicht gespeichert werden: ${error.message}`, 500);
  }

  return ok({ ok: true, anzahl: ids.length });
});
