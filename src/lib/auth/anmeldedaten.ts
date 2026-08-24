import 'server-only';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Adresse und Passwortstand eines angemeldeten Lieferanten.
 *
 * Beides steht nicht in der Sitzung: Die entsteht beim Anmelden mit dem
 * Zugangscode und kennt nur Name und Firma. Fürs Profil braucht es aber die
 * Adresse – sie ist zugleich der Benutzername – und die Angabe, ob schon ein
 * Passwort gesetzt ist.
 *
 * Liegt hier und nicht in der jeweiligen Route, weil die Sitzungsangaben an
 * zwei Stellen gebaut werden: beim ersten Aufbau der Seite und beim späteren
 * Nachladen. Zwei Kopien wären früher oder später auseinandergelaufen.
 *
 * Ohne Migration 0028 gibt es die Spalte nicht; dann gilt "kein Passwort",
 * und die Anmeldung läuft weiter über den Zugangscode.
 */
export async function lieferantAnmeldedaten(
  supplierId: string,
): Promise<{ email: string | null; hatPasswort: boolean }> {
  const db = serviceClient();

  const mit = await db
    .from('suppliers')
    .select('email, passwort_hash')
    .eq('id', supplierId)
    .maybeSingle();

  if (!mit.error && mit.data) {
    const z = mit.data as { email: string | null; passwort_hash: string | null };
    return { email: z.email, hatPasswort: Boolean(z.passwort_hash) };
  }

  const ohne = await db
    .from('suppliers')
    .select('email')
    .eq('id', supplierId)
    .maybeSingle();

  return {
    email: (ohne.data as { email: string | null } | null)?.email ?? null,
    hatPasswort: false,
  };
}
