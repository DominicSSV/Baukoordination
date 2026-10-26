import { ApiError, forbidden, handler, ok, optionalString, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { parseDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

type Zeile = {
  id: string;
  project_id: string;
  supplier_id: string;
};

/**
 * Eine erfasste Zeile ändern oder entfernen.
 *
 * Nur die eigene. Wir sehen die Stunden, berichtigen sie aber nicht: Wer sie
 * geleistet hat, weiss als Einziger, was dort richtig stünde. Stimmt etwas
 * nicht, ist das eine Rückfrage und keine stille Korrektur.
 */
async function eigeneZeile(id: string, supplierId: string): Promise<Zeile> {
  const { data, error } = await serviceClient()
    .from('time_entries')
    .select('id, project_id, supplier_id')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new ApiError(
      'Die Zeiterfassung steht erst nach der Datenbank-Aktualisierung 0048 zur '
        + `Verfügung. (${error.message})`,
      400,
    );
  }

  const zeile = data as Zeile | null;
  if (!zeile) throw new ApiError('Dieser Eintrag existiert nicht.', 404);
  if (zeile.supplier_id !== supplierId) {
    throw forbidden('Das ist die Zeile einer anderen Firma.');
  }

  return zeile;
}

export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  if (ctx.session.kind !== 'supplier') {
    throw forbidden('Geändert wird eine Zeile von der Firma, die sie erfasst hat.');
  }

  await eigeneZeile(id, ctx.session.supplierId);

  const body = await readJson<{
    datum?: string;
    stunden?: number | string;
    beschreibung?: string;
  }>(request);

  const patch: Record<string, unknown> = { edited_at: new Date().toISOString() };

  if (body.datum !== undefined) patch.datum = parseDueDate(body.datum);

  if (body.stunden !== undefined) {
    const stunden = Number(body.stunden);
    if (!Number.isFinite(stunden) || stunden <= 0 || stunden > 24) {
      throw new ApiError('Bitte eine Stundenzahl zwischen 0 und 24 angeben.');
    }
    patch.stunden = Math.round(stunden * 100) / 100;
  }

  if (body.beschreibung !== undefined) {
    patch.beschreibung = optionalString(body.beschreibung, 500);
  }

  const { data, error } = await serviceClient()
    .from('time_entries')
    .update(patch)
    .eq('id', id)
    .eq('supplier_id', ctx.session.supplierId)
    .select(
      'id, project_id, supplier_id, datum, stunden, beschreibung, satz, erfasst_von, created_at',
    )
    .single();

  if (error) throw new ApiError(`Nicht gespeichert: ${error.message}`, 500);
  return ok({ eintrag: data });
});

export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  if (ctx.session.kind !== 'supplier') {
    throw forbidden('Entfernt wird eine Zeile von der Firma, die sie erfasst hat.');
  }

  await eigeneZeile(id, ctx.session.supplierId);

  // Ohne Papierkorb: Eine falsch getippte Stundenzahl ist kein Dokument,
  // sondern ein Vertipper. Sie wiederherstellen zu können, hiesse vor allem,
  // sie in der Summe doppelt zu haben.
  const { error } = await serviceClient()
    .from('time_entries')
    .delete()
    .eq('id', id)
    .eq('supplier_id', ctx.session.supplierId);

  if (error) throw new ApiError(`Nicht entfernt: ${error.message}`, 500);
  return ok({ ok: true });
});
