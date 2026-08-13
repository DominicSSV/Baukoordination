import { ApiError, handler, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

/** So viele Einträge zeigt das Glockenmenü höchstens. */
const ANZAHL = 40;

export type Benachrichtigung = {
  id: string;
  projectId: string;
  projectName: string;
  actorName: string;
  text: string;
  icon: string | null;
  createdAt: string;
};

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

  if (projektIds.length) {
    const { data: projekte } = await ctx.db
      .from('projects')
      .select('id, name')
      .in('id', projektIds);

    for (const p of (projekte ?? []) as Array<{ id: string; name: string }>) {
      namen.set(p.id, p.name);
    }
  }

  const eintraege: Benachrichtigung[] = fremde.slice(0, ANZAHL).map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: namen.get(r.project_id) ?? 'Projekt',
    actorName: r.actor_name,
    text: r.text,
    icon: r.icon,
    createdAt: r.created_at,
  }));

  return ok({ eintraege });
});
