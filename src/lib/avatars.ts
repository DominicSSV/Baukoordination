import 'server-only';
import { serviceClient } from '@/lib/supabase/service';

export const AVATAR_BUCKET = 'avatars';

/** Profilbilder werden häufig angezeigt, deshalb grosszügiger signiert. */
const AVATAR_URL_TTL = 60 * 60 * 6;

/**
 * Signiert mehrere Bildpfade auf einmal.
 *
 * Fehlt der Ablageort noch (Migration 0005 nicht eingespielt) oder ist ein Bild
 * verschwunden, bleibt die Karte einfach ohne Bild – das ist kein Grund, eine
 * ganze Projektansicht scheitern zu lassen.
 */
export async function signAvatars(
  paths: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = Array.from(
    new Set(paths.filter((p): p is string => Boolean(p && p.trim()))),
  );
  if (!unique.length) return map;

  const { data, error } = await serviceClient()
    .storage.from(AVATAR_BUCKET)
    .createSignedUrls(unique, AVATAR_URL_TTL);

  if (error) {
    console.warn('[avatars] Signaturen fehlgeschlagen', error.message);
    return map;
  }

  for (const entry of data ?? []) {
    if (entry.signedUrl && entry.path) map.set(entry.path, entry.signedUrl);
  }
  return map;
}

export async function signAvatar(
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  const map = await signAvatars([path]);
  return map.get(path) ?? null;
}
