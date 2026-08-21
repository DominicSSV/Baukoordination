import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Die Glocke leeren – für sich selbst oder für alle anderen.
 *
 * Geleert heisst ausgeblendet: Gemerkt wird nur ein Zeitpunkt. Das Protokoll
 * bleibt vollständig, denn daran hängen Fotos, Offerten und Terminänderungen,
 * und das Register "Aktivität" lebt davon. Unter "Alle anzeigen" kommt alles
 * wieder zum Vorschein.
 *
 * "Für alle anderen" ist uns vorbehalten und braucht es vor allem einmal: Nach
 * dem Aufbau der App liegen bei allen Beteiligten hunderte Einträge aus der
 * Testzeit in der Glocke.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ andere?: boolean }>(request);
  const jetzt = new Date().toISOString();
  const db = serviceClient();

  if (body.andere) {
    const [wir, lieferanten] = await Promise.all([
      db
        .from('admins')
        .update({ glocke_geleert_bis: jetzt })
        .neq('user_id', ctx.session.userId)
        .select('user_id'),
      db.from('suppliers').update({ glocke_geleert_bis: jetzt }).select('id'),
    ]);

    if (wir.error || lieferanten.error) {
      throw new ApiError(
        'Das geht erst nach der Datenbank-Aktualisierung 0026: ' +
          (wir.error?.message ?? lieferanten.error?.message ?? ''),
        400,
      );
    }

    return ok({
      beiUns: wir.data?.length ?? 0,
      lieferanten: lieferanten.data?.length ?? 0,
    });
  }

  const { error } = await db
    .from('admins')
    .update({ glocke_geleert_bis: jetzt })
    .eq('user_id', ctx.session.userId);

  if (error) {
    throw new ApiError(
      `Das geht erst nach der Datenbank-Aktualisierung 0026: ${error.message}`,
      400,
    );
  }

  return ok({ ok: true });
});
