import 'server-only';
import { firmaSchluessel } from '@/lib/offers';
import { serviceClient } from '@/lib/supabase/service';
import type { Session } from '@/lib/auth/session';

/**
 * Darf diese Sitzung eine Offerte sehen, die von `uploaderId` stammt?
 *
 * Wir sehen alles. Ein Lieferant sieht seine eigenen Einreichungen und die
 * seiner Firma – mehrere Ansprechpersonen derselben Firma arbeiten am selben
 * Angebot. Ohne hinterlegte Firma zählt nur die eigene Einreichung, sonst
 * würden alle Lieferanten ohne Firmeneintrag zu einer Gruppe verschmelzen.
 *
 * Dieselbe Regel steckt als Datenbankfunktion in Migration 0013; hier steht sie
 * für die Wege, die bewusst mit dem Dienstschlüssel lesen.
 */
export async function darfOfferteSehen(
  session: Session,
  uploaderId: string | null,
): Promise<boolean> {
  if (session.kind === 'admin') return true;
  if (!uploaderId) return false;
  if (uploaderId === session.supplierId) return true;

  const meine = firmaSchluessel(session.firma);
  if (!meine) return false;

  const { data } = await serviceClient()
    .from('suppliers')
    .select('firma')
    .eq('id', uploaderId)
    .maybeSingle();

  return firmaSchluessel((data as { firma: string | null } | null)?.firma) === meine;
}

/**
 * Alle Lieferanten derselben Firma – für Benachrichtigungen und für die Frage,
 * wessen Einreichungen zusammengehören.
 */
export async function firmenKollegen(supplierId: string): Promise<string[]> {
  const db = serviceClient();

  const { data: selbst } = await db
    .from('suppliers')
    .select('firma')
    .eq('id', supplierId)
    .maybeSingle();

  const schluessel = firmaSchluessel((selbst as { firma: string | null } | null)?.firma);
  if (!schluessel) return [supplierId];

  const { data } = await db.from('suppliers').select('id, firma');
  const alle = (data ?? []) as Array<{ id: string; firma: string | null }>;

  const ids = alle
    .filter((s) => firmaSchluessel(s.firma) === schluessel)
    .map((s) => s.id);

  return ids.length ? ids : [supplierId];
}
