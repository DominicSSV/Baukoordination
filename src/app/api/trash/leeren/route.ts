import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Den Papierkorb in einem Zug leeren – über alle Projekte.
 *
 * Bisher musste jeder Eintrag einzeln entfernt werden. Nach einem
 * Aufräumtag stehen dort schnell fünfzig Zeilen, und fünfzig Mal auf
 * dasselbe Symbol zu klicken ist keine Sorgfalt, sondern nur mühsam –
 * nach dem zehnten Mal sieht ohnehin niemand mehr hin, was er wegklickt.
 *
 * Nur für die Swiss Solar Ventures AG, und nur mit der Anzahl als
 * Bestätigung: Der Aufrufer schickt mit, wie viele Einträge er gesehen hat.
 * Stimmt die Zahl nicht mehr mit dem überein, was gerade im Papierkorb
 * liegt, bricht der Vorgang ab. So lässt sich nicht versehentlich etwas
 * mitlöschen, das jemand anders in der Zwischenzeit hineingelegt hat.
 *
 * Endgültig heisst endgültig: Danach ist nichts mehr zurückzuholen.
 */
export const POST = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{ erwartet?: number }>(request);
  const erwartet = Number(body.erwartet);

  if (!Number.isInteger(erwartet) || erwartet < 0) {
    throw new ApiError('Es fehlt die Anzahl der Einträge zur Bestätigung.');
  }

  const db = serviceClient();

  const [todos, dateien] = await Promise.all([
    db.from('todos').select('id').not('deleted_at', 'is', null),
    db
      .from('files')
      .select('id, storage_path, thumb_path')
      .not('deleted_at', 'is', null),
  ]);

  if (todos.error || dateien.error) {
    throw new ApiError(
      `Papierkorb nicht lesbar: ${todos.error?.message ?? dateien.error?.message}`,
      500,
    );
  }

  const todoIds = ((todos.data ?? []) as Array<{ id: string }>).map((z) => z.id);
  const dateiZeilen = (dateien.data ?? []) as Array<{
    id: string;
    storage_path: string | null;
    thumb_path: string | null;
  }>;

  const gesamt = todoIds.length + dateiZeilen.length;

  if (gesamt === 0) return ok({ entfernt: 0, dateien: 0, aufgaben: 0 });

  if (gesamt !== erwartet) {
    throw new ApiError(
      `Im Papierkorb liegen jetzt ${gesamt} Einträge, angezeigt wurden ${erwartet}. `
      + 'Bitte die Liste neu laden und noch einmal versuchen.',
    );
  }

  /**
   * Erst die Dateien aus dem Speicher, dann die Zeilen.
   *
   * In dieser Reihenfolge, weil ein Fehler beim Speicher dann keine
   * verwaisten Dateien hinterlässt, die niemand mehr findet: Scheitert er,
   * steht die Zeile noch da und der Versuch lässt sich wiederholen.
   */
  if (dateiZeilen.length) {
    const pfade = dateiZeilen
      .flatMap((z) => [z.storage_path, z.thumb_path])
      .filter((p): p is string => Boolean(p));

    if (pfade.length) {
      // In Blöcken: Der Speicher nimmt nicht beliebig viele Pfade auf einmal.
      for (let i = 0; i < pfade.length; i += 100) {
        const weg = await serviceClient()
          .storage.from(STORAGE_BUCKET)
          .remove(pfade.slice(i, i + 100));
        if (weg.error) console.error('[storage] Nicht entfernt', weg.error);
      }
    }

    const { error } = await db
      .from('files')
      .delete()
      .in('id', dateiZeilen.map((z) => z.id));
    if (error) throw new ApiError(`Dateien nicht entfernt: ${error.message}`, 500);
  }

  if (todoIds.length) {
    const { error } = await db.from('todos').delete().in('id', todoIds);
    if (error) throw new ApiError(`Aufgaben nicht entfernt: ${error.message}`, 500);
  }

  // Bewusst kein Protokolleintrag: Das Weggeworfene stand schon bei seinem
  // Wegwerfen im Protokoll. Ein zweiter Eintrag beim endgültigen Entfernen
  // sagt nichts Neues und macht die Liste nur länger.
  return ok({
    entfernt: gesamt,
    aufgaben: todoIds.length,
    dateien: dateiZeilen.length,
  });
});
