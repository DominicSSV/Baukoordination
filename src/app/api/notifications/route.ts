import { ApiError, handler, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { signAvatars } from '@/lib/avatars';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** So viele Einträge zeigt das Glockenmenü höchstens. */
const ANZAHL = 40;

export type Benachrichtigung = {
  id: string;
  projectId: string;
  projectName: string;
  actorName: string;
  /** Kurzlebige Signatur auf das Profilbild, null = keines hinterlegt. */
  actorAvatarUrl: string | null;
  text: string;
  icon: string | null;
  createdAt: string;
};

/**
 * Profilbilder zu den Namen, die im Protokoll stehen.
 *
 * Das Protokoll hält nur den Namen fest, keine Kennung – also wird über den
 * Namen zugeordnet, genau wie in den Listen der Projektansicht. Wer später
 * umbenannt wurde, erscheint bei alten Einträgen mit seinen Initialen.
 *
 * Gelesen wird mit dem Dienstschlüssel und einer festen Spaltenauswahl: Bilder
 * sollen auch dann erscheinen, wenn die Person selbst nicht im eigenen Projekt
 * sitzt; E-Mail-Adressen oder Zugangscodes verlassen die Abfrage nie.
 */
async function bilderNachName(): Promise<Map<string, string>> {
  const db = serviceClient();

  const [admins, suppliers] = await Promise.all([
    db.from('admins').select('name, avatar_path'),
    db.from('suppliers').select('name, firma, avatar_path'),
  ]);

  type Zeile = { name: string | null; firma?: string | null; avatar_path: string | null };
  const zeilen = [
    ...((admins.data ?? []) as Zeile[]),
    ...((suppliers.data ?? []) as Zeile[]),
  ];

  const urls = await signAvatars(zeilen.map((z) => z.avatar_path));
  const map = new Map<string, string>();

  for (const z of zeilen) {
    const url = z.avatar_path ? urls.get(z.avatar_path) : null;
    if (!url) continue;

    // Lieferanten stehen im Protokoll unter Ansprechperson oder Firma.
    for (const name of [z.name, z.firma]) {
      const schluessel = name?.trim().toLowerCase();
      if (schluessel && !map.has(schluessel)) map.set(schluessel, url);
    }
  }

  return map;
}

/**
 * Neues aus allen Projekten, auf die diese Person Zugriff hat – neuste zuerst.
 *
 * Gelesen wird mit der Sitzung, nicht mit dem Dienstschlüssel: die Datenbank
 * blendet damit fremde Projekte und vertrauliche Einträge (Offerten anderer
 * Firmen) von selbst aus. Was man selbst ausgelöst hat, ist keine Nachricht –
 * das fliegt hier heraus.
 */
export const GET = handler(async () => {
  const ctx = await requireSession();

  const { data, error } = await ctx.db
    .from('activity')
    .select('id, project_id, actor_name, text, icon, created_at')
    .order('created_at', { ascending: false })
    .limit(ANZAHL * 2);

  if (error) {
    throw new ApiError(`Benachrichtigungen: ${error.message}`, 500);
  }

  const rows = (data ?? []) as Array<{
    id: string;
    project_id: string;
    actor_name: string;
    text: string;
    icon: string | null;
    created_at: string;
  }>;

  const eigen = ctx.session.name.trim().toLowerCase();
  const fremde = rows.filter((r) => r.actor_name.trim().toLowerCase() !== eigen);

  const projektIds = Array.from(new Set(fremde.map((r) => r.project_id)));
  const namen = new Map<string, string>();

  const [, bilder] = await Promise.all([
    (async () => {
      if (!projektIds.length) return;
      const { data: projekte } = await ctx.db
        .from('projects')
        .select('id, name')
        .in('id', projektIds);

      for (const p of (projekte ?? []) as Array<{ id: string; name: string }>) {
        namen.set(p.id, p.name);
      }
    })(),
    bilderNachName(),
  ]);

  const eintraege: Benachrichtigung[] = fremde.slice(0, ANZAHL).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: namen.get(r.project_id) ?? 'Projekt',
    actorName: r.actor_name,
    actorAvatarUrl: bilder.get(r.actor_name.trim().toLowerCase()) ?? null,
    text: r.text,
    icon: r.icon,
    createdAt: r.created_at,
  }));

  return ok({ eintraege });
});
