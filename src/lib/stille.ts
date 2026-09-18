import 'server-only';
import { getSession } from '@/lib/auth/session';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Benachrichtigungen vorübergehend abstellen.
 *
 * Wer ein Projekt aufräumt, legt in zehn Minuten fünfzehn Aufgaben an, hakt
 * alte ab und schiebt Termine. Ginge über jeden Handgriff eine Meldung hinaus,
 * hätten am Ende alle ein volles Postfach über Arbeit, die niemanden ausser
 * dem Aufräumenden betraf.
 *
 * Drei Sätze, die den ganzen Sinn ausmachen:
 *
 * 1. Protokolliert wird weiter alles. Das Protokoll ist das Baustellenbuch und
 *    darf keine Lücken haben.
 * 2. Gemeldet wird nichts – weder Mail noch Glocke.
 * 3. Beim Wiedereinschalten wird nichts nachgeholt. Die stillen Einträge
 *    bleiben still. Eine Nachholmeldung wäre genau das, was man vermeiden
 *    wollte.
 *
 * Die Stille gehört der Person, nicht dem Projekt: Stellt Dominic sie zum
 * Aufräumen ab, sollen seine Handgriffe still bleiben – nicht die von Maurice,
 * der zur selben Zeit am selben Projekt etwas Wichtiges einträgt.
 */

/**
 * Ist gerade still geschaltet – für die Person, die diese Anfrage auslöst?
 *
 * Wird von logActivity gefragt, also bei jedem Handgriff. Deshalb bewusst
 * schlank: eine Zeile, Primärschlüssel, kein Nachschlagen von Namen.
 *
 * Fehlt die Tabelle (Migration 0038 nicht eingespielt) oder gibt es keine
 * Sitzung – etwa beim nächtlichen Prüflauf –, ist nichts abgestellt. Im
 * Zweifel wird gemeldet: Eine Meldung zu viel fällt auf, eine fehlende nicht.
 */
export async function istStillGeschaltet(projectId: string): Promise<boolean> {
  try {
    const session = await getSession();
    // Nur wir können abstellen; für Lieferanten gibt es den Schalter nicht.
    if (!session || session.kind !== 'admin') return false;

    return await pauseLaeuft(session.userId, projectId);
  } catch {
    return false;
  }
}

/** Steht für diese Person und dieses Projekt eine Zeile? */
export async function pauseLaeuft(
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('notify_pause')
    .select('seit')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error || !data) return false;
  return true;
}

/** Seit wann abgestellt – null, wenn es läuft. Für die Anzeige im Kopf. */
export async function pauseSeit(
  userId: string,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient()
    .from('notify_pause')
    .select('seit')
    .eq('user_id', userId)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error || !data) return null;
  return (data as { seit: string }).seit;
}

/**
 * Abstellen oder wieder einschalten.
 *
 * Beim Einschalten wird die Zeile gelöscht und sonst nichts getan. Genau das
 * ist gemeint: Was in der Zwischenzeit geschah, bleibt still.
 */
export async function pauseSetzen(
  userId: string,
  projectId: string,
  aus: boolean,
): Promise<{ ok: boolean; fehler?: string }> {
  const db = serviceClient();

  const { error } = aus
    ? await db
        .from('notify_pause')
        .upsert(
          { user_id: userId, project_id: projectId, seit: new Date().toISOString() },
          { onConflict: 'user_id,project_id' },
        )
    : await db
        .from('notify_pause')
        .delete()
        .eq('user_id', userId)
        .eq('project_id', projectId);

  if (error) return { ok: false, fehler: error.message };
  return { ok: true };
}
