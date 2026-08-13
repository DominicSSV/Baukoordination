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
    text: string;
    icon: string;
    notify?: boolean;
    /**
     * Vertraulicher Eintrag: nur wir und dieser eine Lieferant sehen ihn – für
     * Offerten, die andere Lieferanten nichts angehen. null = für alle sichtbar.
     */
    nurFuerSupplierId?: string | null;
  },
): Promise<string | null> {
  const zeile: Record<string, unknown> = {
    project_id: params.projectId,
    actor_name: params.actorName,
    text: params.text,
    icon: params.icon,
  };

  let { error } = await db
    .from('activity')
    .insert(
      params.nurFuerSupplierId
        ? { ...zeile, supplier_id: params.nurFuerSupplierId }
        : zeile,
    );

  // Ohne Migration 0012 fehlt die Spalte. Dann lieber ohne Einschränkung
  // protokollieren als gar nicht – die Datei selbst bleibt trotzdem geschützt.
  if (error && params.nurFuerSupplierId) {
    ({ error } = await db.from('activity').insert(zeile));
  }

  if (error) {
    console.error('[activity] Eintrag konnte nicht gespeichert werden', error);
    return `Aktion gespeichert, aber der Protokolleintrag schlug fehl: ${error.message}`;
  }

  if (params.notify !== false) {
    // Bewusst nicht awaited blockierend für den Nutzer relevant – aber awaited, damit
    // die Serverless-Funktion nicht vor dem Versand beendet wird.
    try {
      await sendActivityNotification({
        projectId: params.projectId,
        actorName: params.actorName,
        actorEmail: params.actorEmail,
        text: params.text,
        nurFuerSupplierId: params.nurFuerSupplierId ?? null,
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
