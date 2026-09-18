import { handler, ok, readJson } from '@/lib/api';
import { requireAdmin, requireSession } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Der Ton beim Abhaken – für alle auf einmal.
 *
 * Bewusst eine Einstellung in der Datenbank und keine Zeile im Code: Sonst
 * müsste für jedes Umschalten neu bereitgestellt werden, und bis das durch ist,
 * hat die Sitzung längst angefangen.
 *
 * Zwei Ebenen, die sich nicht in die Quere kommen: Hier wird entschieden, ob es
 * den Ton überhaupt gibt. Ob ihn eine einzelne Person auf ihrem Telefon hören
 * will, entscheidet sie selbst im Profil – das liegt im Browser und geht
 * niemanden sonst etwas an.
 */
const SCHLUESSEL = 'toene_an';

/**
 * Aus ist der Standard.
 *
 * Auf der Baustelle wird die App im Beisein von Kunden benutzt. Wer den Ton
 * will, schaltet ihn ein; umgekehrt müsste man erst ein Geräusch erklären, das
 * niemand bestellt hat.
 */
async function gespeicherterWert(): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('app_settings')
    .select('value')
    .eq('key', SCHLUESSEL)
    .maybeSingle();

  // Fehlt die Zeile oder die Tabelle, bleibt es beim Standard. Ein stummer Ton
  // ist kein Grund, die Anmeldung scheitern zu lassen.
  if (error || !data) return false;
  return (data as { value: string | null }).value === 'ja';
}

/** Lesen darf jeder Angemeldete – der Ton spielt schliesslich bei jedem. */
export const GET = handler(async () => {
  await requireSession();
  return ok({ an: await gespeicherterWert() });
});

/** Umschalten dürfen nur wir. */
export const PATCH = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{ an?: boolean }>(request);
  const an = body.an === true;

  const { error } = await serviceClient()
    .from('app_settings')
    .upsert({ key: SCHLUESSEL, value: an ? 'ja' : 'nein' }, { onConflict: 'key' });

  if (error) {
    return ok({ an: await gespeicherterWert(), warning: `Nicht gespeichert: ${error.message}` });
  }

  return ok({ an });
});
