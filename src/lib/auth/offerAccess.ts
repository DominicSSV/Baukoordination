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
 * Darf diese Sitzung ein Dokument aus dem Register
 * "Auftragsbestätigungen & Nachträge" sehen?
 *
 * Die Regel, in dieser Reihenfolge:
 *   1. Wir sehen alles. Wer die Baustelle koordiniert, muss jedes Papier
 *      nachschlagen können.
 *   2. Selbst hochgeladen heisst immer sichtbar – niemand soll die eigene
 *      Einreichung verlieren, weil er sich beim Zuweisen vergessen hat.
 *   3. Gibt es keine Zuweisung (Altbestand aus der Zeit vor Migration 0042),
 *      gilt die frühere Regel über die Firma des Einreichers.
 *   4. Sonst: nur wer ausdrücklich zugewiesen wurde. Eine leere Liste heisst
 *      "nur wir" und nicht "alle" – beim Zuweisen etwas zu vergessen darf
 *      nicht dazu führen, dass ein Vertrag offen herumliegt.
 *
 * Dieselbe Regel steckt als Datenbankfunktion in Migration 0042; hier steht
 * sie für die Wege, die bewusst mit dem Dienstschlüssel lesen.
 */
export async function darfDokumentSehen(
  session: Session,
  sichtbarFuer: string[] | null | undefined,
  uploaderId: string | null,
): Promise<boolean> {
  if (session.kind === 'admin') return true;
  if (uploaderId && uploaderId === session.supplierId) return true;

  // Altbestand ohne Zuweisung: die frühere Regel.
  if (sichtbarFuer === null || sichtbarFuer === undefined) {
    return darfOfferteSehen(session, uploaderId);
  }

  return sichtbarFuer.includes(session.supplierId);
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
