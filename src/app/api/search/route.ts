import { handler, ok } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { ordnerName } from '@/lib/offers';
import type { TabKey } from '@/components/workspace/Workspace';

export const dynamic = 'force-dynamic';

/** Mehr Treffer als das liest ohnehin niemand durch. */
const PRO_ART = 8;

export type Treffer = {
  art: 'projekt' | 'todo' | 'datei' | 'arbeit' | 'lieferant';
  id: string;
  projectId: string;
  projektName: string;
  titel: string;
  zusatz: string | null;
  /** Register, in dem der Treffer steht. */
  ziel: TabKey;
};

/**
 * Suche über Projekte, Aufgaben, Dateien, Terminplan und Lieferanten.
 *
 * Bewusst über ctx.db und nicht über den Dienstschlüssel: So gelten dieselben
 * Regeln wie überall sonst. Ein Lieferant findet damit nur, was er ohnehin
 * sehen darf – keine fremden Offerten, keine fremden Aufgaben.
 */
export const GET = handler(async (request: Request) => {
  const ctx = await requireSession();

  const suche = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (suche.length < 2) return ok({ treffer: [] as Treffer[] });

  // % und _ hätten in ilike eine eigene Bedeutung und würden sonst alles
  // finden – hier zählt der eingegebene Text, nicht das Muster.
  const muster = `%${suche.replace(/[%_\\]/g, (z) => `\\${z}`)}%`;

  const [projekte, todos, dateien, arbeiten, lieferanten] = await Promise.all([
    ctx.db
      .from('projects')
      .select('id, name, ort')
      .or(`name.ilike.${muster},ort.ilike.${muster}`)
      .limit(PRO_ART),
    ctx.db
      .from('todos')
      .select('id, project_id, text, done')
      .ilike('text', muster)
      // Weggeräumtes gehört nicht in die Suche: Wer es findet und anklickt,
      // landet bei einer Aufgabe, die es für ihn nicht mehr gibt.
      .is('deleted_at', null)
      .limit(PRO_ART),
    ctx.db
      .from('files')
      .select('id, project_id, name, offer_folder')
      .ilike('name', muster)
      .limit(PRO_ART),
    ctx.db
      .from('schedule_tasks')
      .select('id, project_id, label, responsible, start_date')
      .or(`label.ilike.${muster},responsible.ilike.${muster}`)
      .limit(PRO_ART),
    ctx.session.kind === 'admin'
      ? ctx.db
          .from('suppliers')
          .select('id, name, firma, gewerk')
          .or(`name.ilike.${muster},firma.ilike.${muster},gewerk.ilike.${muster}`)
          .limit(PRO_ART)
      : Promise.resolve({ data: [], error: null }),
  ]);

  // Projektnamen für die Herkunftszeile. Die eigene Abfrage oben liefert nur
  // die Treffer, hier braucht es alle sichtbaren.
  const alle = await ctx.db.from('projects').select('id, name');
  const namen = new Map(
    ((alle.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  );

  const treffer: Treffer[] = [];

  for (const p of (projekte.data ?? []) as Array<{
    id: string;
    name: string;
    ort: string | null;
  }>) {
    treffer.push({
      art: 'projekt',
      id: p.id,
      projectId: p.id,
      projektName: p.name,
      titel: p.name,
      zusatz: p.ort,
      ziel: 'todos',
    });
  }

  for (const t of (todos.data ?? []) as Array<{
    id: string;
    project_id: string;
    text: string;
    done: boolean;
  }>) {
    treffer.push({
      art: 'todo',
      id: t.id,
      projectId: t.project_id,
      projektName: namen.get(t.project_id) ?? '',
      titel: t.text,
      zusatz: t.done ? 'erledigt' : null,
      ziel: 'todos',
    });
  }

  for (const f of (dateien.data ?? []) as Array<{
    id: string;
    project_id: string;
    name: string;
    offer_folder: string | null;
  }>) {
    treffer.push({
      art: 'datei',
      id: f.id,
      projectId: f.project_id,
      projektName: namen.get(f.project_id) ?? '',
      titel: f.name,
      zusatz: f.offer_folder ? ordnerName(f.offer_folder) : null,
      ziel: f.offer_folder ? 'offerten' : 'dateien',
    });
  }

  for (const a of (arbeiten.data ?? []) as Array<{
    id: string;
    project_id: string;
    label: string;
    responsible: string | null;
    start_date: string;
  }>) {
    treffer.push({
      art: 'arbeit',
      id: a.id,
      projectId: a.project_id,
      projektName: namen.get(a.project_id) ?? '',
      titel: a.label,
      zusatz: [a.responsible, a.start_date].filter(Boolean).join(' · ') || null,
      ziel: 'terminplan',
    });
  }

  for (const l of (lieferanten.data ?? []) as Array<{
    id: string;
    name: string | null;
    firma: string | null;
    gewerk: string | null;
  }>) {
    treffer.push({
      art: 'lieferant',
      id: l.id,
      projectId: '',
      projektName: '',
      titel: [l.name, l.firma].filter(Boolean).join(' · ') || 'Ohne Namen',
      zusatz: l.gewerk,
      ziel: 'lieferanten',
    });
  }

  return ok({ treffer });
});
