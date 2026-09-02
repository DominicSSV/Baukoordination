import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Was abgetippt werden muss, damit gelöscht wird.
 *
 * Der Wortlaut steht hier und wird geprüft, nicht bloss in der Ansicht: Ein
 * Knopf, der ohne Weiteres das ganze Protokoll wegräumt, darf nicht durch einen
 * versehentlichen Aufruf auslösbar sein.
 */
const BESTAETIGUNG = 'ALLES LOESCHEN';

/**
 * Das gesamte Protokoll löschen und bei allen die Glocke auf null setzen.
 *
 * Gedacht als Neustart nach der Aufbauphase: Testdaten, verschobene Aufgaben,
 * auf einmal übernommene Meilensteine – nichts davon ist im Betrieb noch etwas
 * wert, und im Register "Aktivität" wie in der Glocke steht es allen im Weg.
 *
 * ACHTUNG: Nicht rückgängig zu machen. Am Protokoll hängt zwar nichts – es ist
 * eine reine Mitschrift, und auf die Tabelle verweist kein Fremdschlüssel –,
 * aber die Mitschrift selbst ist danach weg: wer wann was gemacht hat.
 *
 * Bewusst mit dem Dienstschlüssel: Über die Sitzung greift die RLS-Regel, und
 * die lässt niemanden fremde Projekte anfassen. Gemeint ist hier aber
 * ausdrücklich alles. Adminrechte prüft requireAdmin davor.
 */
export const DELETE = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ bestaetigung?: string }>(request);
  if ((body.bestaetigung ?? '').trim().toUpperCase() !== BESTAETIGUNG) {
    throw new ApiError(
      `Zum Löschen muss „${BESTAETIGUNG}“ abgetippt werden.`,
      400,
    );
  }

  const db = serviceClient();

  // Erst zählen: Danach lässt sich nicht mehr sagen, wie viel es war, und eine
  // Rückmeldung ohne Zahl klingt, als sei nichts geschehen.
  const vorher = await db.from('activity').select('id');
  if (vorher.error) {
    throw new ApiError(`Protokoll nicht lesbar: ${vorher.error.message}`, 500);
  }
  const anzahl = (vorher.data ?? []).length;

  // Ohne "where" löscht PostgREST nichts. Die Bedingung trifft jede Zeile:
  // project_id ist als not null angelegt.
  const { error } = await db.from('activity').delete().not('project_id', 'is', null);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  // Die Glocke aller auf null – auch die eigene. Nach dem Löschen ist ohnehin
  // nichts mehr da; die Marke sorgt dafür, dass auch "Alle anzeigen" nichts aus
  // der Aufbauzeit hervorholt, falls doch eine Zeile übrig blieb.
  const jetzt = new Date().toISOString();
  const [wir, lieferanten] = await Promise.all([
    db.from('admins').update({ glocke_geleert_bis: jetzt }).not('user_id', 'is', null),
    db.from('suppliers').update({ glocke_geleert_bis: jetzt }).not('id', 'is', null),
  ]);

  // Ohne Migration 0026 gibt es die Spalte nicht. Das Protokoll ist dann
  // trotzdem gelöscht – und darum ging es.
  const glockeGesetzt = !wir.error && !lieferanten.error;

  return ok({ geloescht: anzahl, glockeGesetzt, wer: ctx.session.name });
});
