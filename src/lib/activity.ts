import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '@/lib/supabase/service';
import { sendActivityNotification } from '@/lib/email';

/**
 * Schreibt einen Protokolleintrag und stösst – falls Mailversand konfiguriert ist –
 * die Sofortbenachrichtigung an die Projektbeteiligten an.
 *
 * Der Protokolleintrag darf die auslösende Aktion nie zum Scheitern bringen:
 * Fehler werden geloggt und als Text zurückgegeben, aber nicht geworfen.
 */
export async function logActivity(
  db: SupabaseClient,
  params: {
    projectId: string;
    actorName: string;
    /** Wird von der Benachrichtigung ausgenommen – niemand braucht Post über sich selbst. */
    actorEmail?: string | null;
    /**
     * Dasselbe für Lieferanten: Die melden sich mit einem Zugangscode an, ihre
     * Mailadresse steht nicht in der Sitzung und muss nachgeschlagen werden.
     */
    actorSupplierId?: string | null;
    text: string;
    icon: string;
    /**
     * Post verschicken? Standard ist nein.
     *
     * Die Glocke zeigt jede Kleinigkeit, das kostet niemanden etwas. Eine Mail
     * dagegen unterbricht – die gibt es nur für die Ereignisse, die den
     * Arbeitstag wirklich verändern: neue Aufgabe, Kommentar zu einer Aufgabe,
     * hochgeladenes Dokument oder Offerte, Änderung am Terminplan. Wird hier
     * einmal etwas vergessen, bleibt es still, statt ungefragt Post zu erzeugen.
     */
    notify?: boolean;
    /**
     * Eingeschränkter Eintrag. Weglassen = für alle mit Projektzugriff sichtbar.
     * Eine Liste beschränkt ihn auf uns und die Firmen dieser Lieferanten; eine
     * leere Liste heisst: nur wir.
     */
    nurFuerSupplierIds?: string[];
    /**
     * Post nur an uns – unabhängig davon, wer den Eintrag sehen darf.
     *
     * Sichtbarkeit und Postverteiler sind nicht dasselbe: Zu einer vertraulichen
     * Aufgabe dürfen die beteiligten Lieferanten den Kommentar sehr wohl sehen,
     * sie sollen darüber aber keine Mail nach draussen bekommen. Ohne diesen
     * Schalter müsste man dafür die Sichtbarkeit beschneiden – und den
     * Lieferanten damit etwas wegnehmen, das sie brauchen.
     */
    nurUnsBenachrichtigen?: boolean;
  },
): Promise<string | null> {
  const zeile: Record<string, unknown> = {
    project_id: params.projectId,
    actor_name: params.actorName,
    text: params.text,
    icon: params.icon,
  };

  const eingeschraenkt = params.nurFuerSupplierIds !== undefined;

  let { error } = await db
    .from('activity')
    .insert(
      eingeschraenkt
        ? { ...zeile, supplier_ids: params.nurFuerSupplierIds }
        : zeile,
    );

  // Ohne Migration 0015 gibt es die Spalte supplier_ids noch nicht. Dann greift
  // ersatzweise die Einzelspalte aus 0012 – besser als gar kein Schutz.
  if (error && eingeschraenkt) {
    const einer = params.nurFuerSupplierIds?.[0] ?? null;
    ({ error } = await db
      .from('activity')
      .insert(einer ? { ...zeile, supplier_id: einer } : zeile));
  }

  // Auch die gibt es vor 0012 nicht. Dann lieber ohne Einschränkung
  // protokollieren als gar nicht – Aufgaben und Dateien bleiben trotzdem
  // geschützt, es steht nur der Protokolltext für alle da.
  if (error && eingeschraenkt) {
    ({ error } = await db.from('activity').insert(zeile));
  }

  if (error) {
    console.error('[activity] Eintrag konnte nicht gespeichert werden', error);
    return `Aktion gespeichert, aber der Protokolleintrag schlug fehl: ${error.message}`;
  }

  if (params.notify === true) {
    // Bewusst nicht awaited blockierend für den Nutzer relevant – aber awaited, damit
    // die Serverless-Funktion nicht vor dem Versand beendet wird.
    try {
      await sendActivityNotification({
        projectId: params.projectId,
        actorName: params.actorName,
        actorEmail: params.actorEmail,
        actorSupplierId: params.actorSupplierId,
        text: params.text,
        // Leere Liste = nur wir. Der geschriebene Eintrag oben behält davon
        // unberührt seine eigene Sichtbarkeit.
        nurFuerSupplierIds: params.nurUnsBenachrichtigen
          ? []
          : params.nurFuerSupplierIds,
      });
    } catch (e) {
      console.error('[activity] Benachrichtigung fehlgeschlagen', e);
    }
  }

  return null;
}

/** Aufräumen: das Protokoll soll nicht unbegrenzt wachsen (wie im Prototyp: 150). */
export async function trimActivity(projectId: string, keep = 300): Promise<void> {
  const db = serviceClient();
  const { data } = await db
    .from('activity')
    .select('id')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .range(keep, keep + 200);

  if (data && data.length) {
    await db
      .from('activity')
      .delete()
      .in(
        'id',
        data.map((r) => r.id),
      );
  }
}
