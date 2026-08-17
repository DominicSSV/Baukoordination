import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { pruefeZustaendigen } from '@/lib/auth/assignTarget';

export const dynamic = 'force-dynamic';

/**
 * Die Zuständigen einer ganzen Zeile setzen – eine Arbeit kann mehreren
 * Personen gehören.
 *
 * In einem Zug für alle Balken der Zeile: Bräche es mittendrin ab, stünde die
 * Zeile zweigeteilt da, weil die Ansicht nach den Zuständigen gruppiert.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ ids?: unknown; owners?: unknown }>(request);

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string' && !!id.trim())
    : [];

  if (!ids.length) throw new ApiError('Keine Arbeiten übergeben.');

  const roh = Array.isArray(body.owners)
    ? body.owners.filter((o): o is string => typeof o === 'string' && !!o.trim())
    : [];

  // Alle Arbeiten der Zeile gehören zum selben Projekt – für die Prüfung
  // genügt daher das Projekt der ersten.
  const erste = await ctx.db
    .from('schedule_tasks')
    .select('project_id')
    .eq('id', ids[0])
    .maybeSingle();

  if (!erste.data) throw new ApiError('Arbeit nicht gefunden.', 404);
  const projectId = (erste.data as { project_id: string }).project_id;

  // Jeder Eintrag wird einzeln geprüft: Nur Personen, die tatsächlich zu diesem
  // Projekt gehören, dürfen zuständig sein.
  const geprueft: string[] = [];
  for (const wert of roh) {
    const ok1 = await pruefeZustaendigen(ctx.session, projectId, wert);
    if (!ok1) throw new ApiError('Diese Person gehört nicht zu diesem Projekt.');
    if (!geprueft.includes(ok1)) geprueft.push(ok1);
  }

  // owner zieht die Datenbank aus dem ersten Eintrag nach (Migration 0022).
  const mitListe = await ctx.db
    .from('schedule_tasks')
    .update({ owners: geprueft })
    .in('id', ids)
    .eq('project_id', projectId);

  // Ohne Migration 0022 gibt es die Liste noch nicht – dann eben nur der Erste.
  if (mitListe.error) {
    const { error } = await ctx.db
      .from('schedule_tasks')
      .update({ owner: geprueft[0] ?? null })
      .in('id', ids)
      .eq('project_id', projectId);

    if (error) {
      throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);
    }

    return ok({ ok: true, owners: geprueft.slice(0, 1), nurEiner: true });
  }

  return ok({ ok: true, owners: geprueft });
});
