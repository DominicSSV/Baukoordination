import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireSession } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';
import type { ProjektGruppe } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Die Sparten über den Projekten: PVA, BESS, Heizung …
 *
 * Lesen darf jeder Angemeldete – ohne die Namen stünde die Seitenleiste bei
 * den Lieferanten ohne Gliederung da, und ein Spartenname ist kein Geheimnis.
 * Ändern dürfen nur wir.
 */
export const GET = handler(async () => {
  await requireSession();

  const { data, error } = await serviceClient()
    .from('project_groups')
    .select('id, name, order_index, farbe')
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    // Ohne Migration 0045 fehlt nur die Farbspalte – dann ohne sie lesen und
    // die Farbe in der Anzeige aus dem Namen ableiten.
    const ohneFarbe = await serviceClient()
      .from('project_groups')
      .select('id, name, order_index')
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true });

    // Ohne Migration 0043 gibt es die Tabelle gar nicht. Dann bleibt die
    // Seitenleiste bei der bisherigen Gliederung nach Phase – kein Fehler.
    if (ohneFarbe.error) return ok({ gruppen: [], ohneTabelle: true });
    return ok({ gruppen: (ohneFarbe.data ?? []) as ProjektGruppe[], ohneFarben: true });
  }

  return ok({ gruppen: (data ?? []) as ProjektGruppe[] });
});

/** Eine neue Sparte anlegen – sie kommt ans Ende. */
export const POST = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{ name?: string }>(request);
  const name = requireString(body.name, 'Name der Gruppe', 80);

  const db = serviceClient();
  const { data: letzte } = await db
    .from('project_groups')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Zehnerschritte, damit sich später etwas dazwischenschieben lässt.
  const naechste = ((letzte as { order_index: number } | null)?.order_index ?? 0) + 10;

  const { data, error } = await db
    .from('project_groups')
    .insert({ name, order_index: naechste })
    .select('id, name, order_index, farbe')
    .single();

  if (error) {
    // Ohne Migration 0045 fehlt nur die Farbspalte – daran soll das Anlegen
    // einer Gruppe nicht scheitern.
    const ohneFarbe = await db
      .from('project_groups')
      .insert({ name, order_index: naechste })
      .select('id, name, order_index')
      .single();

    if (ohneFarbe.error) {
      throw new ApiError(
        `Die Gruppe konnte nicht angelegt werden: ${ohneFarbe.error.message}. Fehlt Migration 0043?`,
        500,
      );
    }

    return ok({ gruppe: ohneFarbe.data as ProjektGruppe }, { status: 201 });
  }

  return ok({ gruppe: data as ProjektGruppe }, { status: 201 });
});

/**
 * Umbenennen oder die ganze Reihenfolge neu setzen.
 *
 * Die Reihenfolge kommt als vollständige Liste und nicht als "schiebe diese
 * eine nach oben": So kann der Bildschirm die neue Abfolge gleich zeigen und
 * schickt sie nur noch hinterher. Ein Tausch von zwei Nachbarn, der auf halbem
 * Weg abbricht, hinterlässt sonst zwei Sparten mit derselben Nummer.
 */
export const PATCH = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{
    id?: string;
    name?: string;
    farbe?: string;
    reihenfolge?: string[];
  }>(request);
  const db = serviceClient();

  if (Array.isArray(body.reihenfolge)) {
    let nummer = 10;
    for (const id of body.reihenfolge) {
      await db.from('project_groups').update({ order_index: nummer }).eq('id', id);
      nummer += 10;
    }
    return ok({ ok: true });
  }

  const id = requireString(body.id, 'Gruppe', 64);

  // Name und Farbe kommen einzeln: Wer nur faerbt, schickt keinen Namen mit,
  // und wer nur umbenennt, keine Farbe.
  const aenderung: { name?: string; farbe?: string } = {};

  if (body.name !== undefined) {
    aenderung.name = requireString(body.name, 'Name der Gruppe', 80);
  }

  if (body.farbe !== undefined) {
    const farbe = requireString(body.farbe, 'Farbe', 7);
    // Nur #RRGGBB. Die Farbe geht ungeprueft in ein style-Attribut – was hier
    // durchkommt, steht spaeter im Bildschirm des Lieferanten.
    if (!/^#[0-9a-fA-F]{6}$/.test(farbe)) {
      throw new ApiError('Das ist keine Farbe in der Form #RRGGBB.', 400);
    }
    aenderung.farbe = farbe;
  }

  if (!Object.keys(aenderung).length) {
    throw new ApiError('Es war nichts zu ändern.', 400);
  }

  const { data, error } = await db
    .from('project_groups')
    .update(aenderung)
    .eq('id', id)
    .select('id, name, order_index, farbe')
    .single();

  if (error) {
    throw new ApiError(
      aenderung.farbe
        ? `Die Farbe wurde nicht gespeichert: ${error.message}. Fehlt Migration 0045?`
        : `Nicht umbenannt: ${error.message}`,
      500,
    );
  }

  return ok({ gruppe: data as ProjektGruppe });
});

/**
 * Eine Sparte entfernen.
 *
 * Die Projekte darin bleiben stehen und rutschen unter "Ohne Gruppe" – dafür
 * sorgt das ON DELETE SET NULL in der Datenbank. Eine Gliederung zu ändern
 * darf niemals Projekte verschwinden lassen.
 */
export const DELETE = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{ id?: string }>(request);
  const id = requireString(body.id, 'Gruppe', 64);

  const db = serviceClient();
  const { count } = await db
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', id);

  const { error } = await db.from('project_groups').delete().eq('id', id);
  if (error) throw new ApiError(`Nicht gelöscht: ${error.message}`, 500);

  return ok({ ok: true, verschoben: count ?? 0 });
});
