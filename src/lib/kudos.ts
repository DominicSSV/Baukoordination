import 'server-only';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Daumen hoch auf einen Kommentar.
 *
 * Auf der Baustelle braucht es oft keine Antwort, sondern nur ein Zeichen:
 * gesehen, einverstanden, macht so. Wer dafür "ok" schreiben muss, schreibt es
 * nicht – und der Fragende wartet weiter.
 */
export type Daumen = {
  /** 'admin:<user_id>' oder 'supplier:<id>' – wie bei den Zuständigen. */
  wer: string;
  name: string;
};

export type KudosArt = 'todo' | 'datei';

/**
 * Gelesen wird mit dem Dienstschlüssel.
 *
 * Die Tabelle hat bewusst keine RLS-Regel: Ob jemand einen Kommentar sehen
 * darf, ist beim Kommentar selbst geregelt. Diese Funktion wird nur aufgerufen,
 * nachdem der Zugriff auf das Projekt geprüft ist – sie bekommt ausschliesslich
 * Kennungen von Kommentaren, die der Aufrufer ohnehin sieht.
 *
 * Fehlt Migration 0036, bleiben die Listen leer. Ein fehlender Daumen ist kein
 * Grund, eine Projektansicht scheitern zu lassen.
 */
export async function ladeDaumen(
  art: KudosArt,
  commentIds: string[],
): Promise<Map<string, Daumen[]>> {
  const map = new Map<string, Daumen[]>();
  if (!commentIds.length) return map;

  const { data, error } = await serviceClient()
    .from('comment_kudos')
    .select('comment_id, wer, name')
    .eq('art', art)
    .in('comment_id', commentIds)
    .order('created_at', { ascending: true });

  if (error) return map;

  for (const z of (data ?? []) as Array<{
    comment_id: string;
    wer: string;
    name: string;
  }>) {
    const liste = map.get(z.comment_id) ?? [];
    liste.push({ wer: z.wer, name: z.name });
    map.set(z.comment_id, liste);
  }

  return map;
}
