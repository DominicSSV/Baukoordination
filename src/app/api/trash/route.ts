import { handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { PapierkorbEintrag } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Der Papierkorb über alle Projekte hinweg.
 *
 * Nur für die Swiss Solar Ventures AG: Zurückholen greift in etwas ein, das
 * jemand anders weggeworfen hat – und ein Lieferant sähe hier ausserdem, was
 * die anderen Firmen eingereicht und wieder entfernt haben.
 *
 * Ausgeführt werden Zurückholen und endgültiges Entfernen weiterhin über
 * /api/projects/<id>/trash; jeder Eintrag bringt seine Projektkennung mit.
 */
export const GET = handler(async () => {
  const ctx = await requireAdmin();

  const [projekte, aufgaben, dateien] = await Promise.all([
    ctx.db.from('projects').select('id, name'),
    ctx.db
      .from('todos')
      .select('id, project_id, text, deleted_at, deleted_by')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
    ctx.db
      .from('files')
      .select('id, project_id, name, offer_folder, deleted_at, deleted_by')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false }),
  ]);

  // Ohne Migration 0017 gibt es die Spalten noch nicht – dann ist der Korb leer.
  if (aufgaben.error || dateien.error) {
    return ok({
      eintraege: [] as PapierkorbEintrag[],
      hinweis:
        'Der Papierkorb steht erst nach Migration 0017 zur Verfügung. Bis dahin ' +
        'wird wie bisher endgültig gelöscht.',
    });
  }

  const namen = new Map((projekte.data ?? []).map((p) => [p.id, p.name]));

  const eintraege: PapierkorbEintrag[] = [
    ...((aufgaben.data ?? []) as Array<{
      id: string;
      project_id: string;
      text: string;
      deleted_at: string;
      deleted_by: string | null;
    }>).map((t) => ({
      art: 'todo' as const,
      id: t.id,
      projectId: t.project_id,
      projektName: namen.get(t.project_id) ?? 'Unbekanntes Projekt',
      text: t.text,
      zusatz: 'Aufgabe',
      deletedAt: t.deleted_at,
      deletedBy: t.deleted_by,
    })),
    ...((dateien.data ?? []) as Array<{
      id: string;
      project_id: string;
      name: string;
      offer_folder: string | null;
      deleted_at: string;
      deleted_by: string | null;
    }>).map((f) => ({
      art: 'datei' as const,
      id: f.id,
      projectId: f.project_id,
      projektName: namen.get(f.project_id) ?? 'Unbekanntes Projekt',
      text: f.name,
      zusatz: f.offer_folder ? 'Offerte' : 'Datei',
      deletedAt: f.deleted_at,
      deletedBy: f.deleted_by,
    })),
  ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));

  return ok({ eintraege });
});
