import {
  ApiError,
  handler,
  ok,
  optionalString,
  readJson,
  requireString,
} from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { loadProjectDetail } from '@/lib/projects';
import { parseDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';
import { STORAGE_BUCKET } from '@/lib/env';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, id);

  return ok({ detail: await loadProjectDetail(ctx, id) });
});

/** Projektname und Ort ändern – nur die Swiss Solar Ventures AG. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    name?: string;
    ort?: string;
    scheduleStart?: string | null;
    scheduleEnd?: string | null;
    status?: string;
  }>(request);

  const patch: Record<string, unknown> = {};

  // Der Zeitraum lässt sich unabhängig vom Namen ändern; der Terminplan schickt
  // nur ihn, das Umbenennen-Formular nur Name und Ort.
  if (body.name !== undefined) {
    patch.name = requireString(body.name, 'Projektname', 200);
  }
  if (body.ort !== undefined) patch.ort = optionalString(body.ort, 200);
  if (body.scheduleStart !== undefined) {
    patch.schedule_start = parseDueDate(body.scheduleStart);
  }
  if (body.scheduleEnd !== undefined) {
    patch.schedule_end = parseDueDate(body.scheduleEnd);
  }
  if (body.status !== undefined) {
    const erlaubt = ['planung', 'umsetzung', 'abschluss', 'abgeschlossen'];
    if (!erlaubt.includes(String(body.status))) {
      throw new ApiError('Unbekannter Projektstatus.');
    }
    patch.status = body.status;
  }

  if (!Object.keys(patch).length) throw new ApiError('Keine Änderung übergeben.');

  const { data, error } = await ctx.db
    .from('projects')
    .update(patch)
    .eq('id', id)
    .select('id, name, ort, created_at, schedule_start, schedule_end, status, order_index')
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);

  return ok({ project: data });
});

/**
 * Ein Projekt endgültig löschen.
 *
 * Das ist der einzige Vorgang in der App, der nicht rückgängig zu machen ist:
 * Mit dem Projekt gehen Aufgaben, Dateien, Offerten, Terminplan, Protokoll und
 * die Freigaben. Der Papierkorb hilft hier nicht – er hängt selbst am Projekt.
 *
 * Deshalb muss der Projektname mitgeschickt werden und genau stimmen. Ein
 * blosses "Sind Sie sicher?" klickt man auf der Baustelle mit Handschuhen weg,
 * einen abgetippten Namen nicht.
 *
 * Die Dateien im Speicher werden zuerst entfernt. Umgekehrt bliebe bei einem
 * Abbruch ein Projekt ohne Inhalt zurück; so bleibt im schlechtesten Fall ein
 * vollständiges Projekt mit ein paar fehlenden Dateien – das ist der weniger
 * schlimme Ausgang.
 */
export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { data: projekt } = await ctx.db
    .from('projects')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();

  if (!projekt) throw new ApiError('Projekt nicht gefunden.', 404);

  const { name } = await readJson<{ name?: string }>(request);
  const zeile = projekt as { id: string; name: string };

  if (String(name ?? '').trim() !== zeile.name.trim()) {
    throw new ApiError(
      `Zum Löschen bitte den Projektnamen genau eingeben: „${zeile.name}“.`,
    );
  }

  // Auch die Dateien im Papierkorb: Die Zeile verschwindet mit dem Projekt,
  // das Objekt im Speicher bliebe sonst für immer liegen und zählt weiter
  // gegen das Speicherkontingent.
  const dienst = serviceClient();
  const { data: dateien } = await dienst
    .from('files')
    .select('storage_path, thumb_path')
    .eq('project_id', id);

  const pfade = ((dateien ?? []) as Array<{
    storage_path: string | null;
    thumb_path: string | null;
  }>)
    .flatMap((d) => [d.storage_path, d.thumb_path])
    .filter((p): p is string => Boolean(p));

  if (pfade.length) {
    const weg = await dienst.storage.from(STORAGE_BUCKET).remove(pfade);
    if (weg.error) console.error('[storage] Projektdateien nicht entfernt', weg.error);
  }

  // Dateien und Dokumentordner müssen vor dem Projekt weg, und zwar in dieser
  // Reihenfolge.
  //
  // Auf den Ordnern sitzt ein Wächter, der das Löschen verweigert, solange noch
  // ein Dokument oder ein Unterordner darin liegt – gedacht gegen das
  // versehentliche Wegräumen eines vollen Ordners. Beim Löschen des Projekts
  // räumt die Datenbank die Ordner selbst weg, der Wächter feuert dabei mit und
  // bricht den ganzen Vorgang ab: "Der Ordner enthält noch 3 Unterordner."
  //
  // Deshalb wird hier von innen nach aussen aufgeräumt: erst die Dokumente,
  // dann die Unterordner, dann die Hauptordner. Danach ist jeder Ordner leer
  // und der Wächter hat nichts mehr einzuwenden.
  const dateienWeg = await ctx.db.from('files').delete().eq('project_id', id);
  if (dateienWeg.error) {
    throw new ApiError(`Löschen fehlgeschlagen: ${dateienWeg.error.message}`, 500);
  }

  const unterordner = await ctx.db
    .from('document_folders')
    .delete()
    .eq('project_id', id)
    .not('parent_id', 'is', null);

  // Ohne Migration 0021 gibt es keine Unterordner – dann fällt dieser Schritt
  // weg und der nächste erledigt alles.
  if (unterordner.error) {
    console.warn('[projekt] Unterordner nicht gesondert entfernt', unterordner.error);
  }

  const ordner = await ctx.db.from('document_folders').delete().eq('project_id', id);
  if (ordner.error) {
    throw new ApiError(`Löschen fehlgeschlagen: ${ordner.error.message}`, 500);
  }

  // Alles Übrige hängt per ON DELETE CASCADE am Projekt.
  const { error } = await ctx.db.from('projects').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true, name: zeile.name, dateien: pfade.length });
});
