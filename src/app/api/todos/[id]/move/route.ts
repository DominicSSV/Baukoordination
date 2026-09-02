import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Manuelles Sortieren per Pfeil-Buttons (kein Drag & Drop – auf Mobile unzuverlässig).
 * Getauscht werden die order_index-Werte der beiden benachbarten Aufgaben.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { direction } = await readJson<{ direction?: string }>(request);
  if (direction !== 'up' && direction !== 'down') {
    throw new ApiError('Richtung muss "up" oder "down" sein.');
  }

  const { data: todo } = await ctx.db
    .from('todos')
    .select('id, project_id, order_index, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!todo) throw new ApiError('Aufgabe nicht gefunden.', 404);

  const { data: siblings, error } = await ctx.db
    .from('todos')
    .select('id, order_index')
    .eq('project_id', todo.project_id)
    // Nur was auch in der Liste steht: Läge eine weggeräumte Aufgabe dazwischen,
    // täte der Pfeil scheinbar nichts – getauscht würde mit einer Zeile, die
    // niemand sieht.
    .is('deleted_at', null)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new ApiError(`Sortierung: ${error.message}`, 500);

  const list = siblings ?? [];
  const index = list.findIndex((t) => t.id === id);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;

  if (index === -1 || targetIndex < 0 || targetIndex >= list.length) {
    return ok({ ok: true, moved: false });
  }

  const neighbour = list[targetIndex];

  // Gleiche order_index-Werte (z.B. nach einem Import) machen einen Tausch wirkungslos –
  // in dem Fall wird die ganze Liste einmal sauber neu durchnummeriert.
  if (neighbour.order_index === todo.order_index) {
    const reordered = [...list];
    [reordered[index], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[index],
    ];
    for (let i = 0; i < reordered.length; i += 1) {
      const update = await ctx.db
        .from('todos')
        .update({ order_index: i + 1 })
        .eq('id', reordered[i].id);
      if (update.error) {
        throw new ApiError(`Sortierung fehlgeschlagen: ${update.error.message}`, 500);
      }
    }
    return ok({ ok: true, moved: true });
  }

  const first = await ctx.db
    .from('todos')
    .update({ order_index: neighbour.order_index })
    .eq('id', todo.id);
  if (first.error) {
    throw new ApiError(`Sortierung fehlgeschlagen: ${first.error.message}`, 500);
  }

  const second = await ctx.db
    .from('todos')
    .update({ order_index: todo.order_index })
    .eq('id', neighbour.id);
  if (second.error) {
    throw new ApiError(`Sortierung fehlgeschlagen: ${second.error.message}`, 500);
  }

  return ok({ ok: true, moved: true });
});
