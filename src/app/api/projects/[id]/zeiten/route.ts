import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireAdmin, requireProjectAccess } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';
import { supplierLabel } from '@/lib/format';
import type { Zeiteintrag } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN =
  'id, project_id, supplier_id, admin_user_id, wer, firma, datum, stunden, stundensatz, beschreibung, erfasst_von, created_at';

/**
 * Zeiterfassung eines Projekts.
 *
 * VORERST NUR FÜR UNS. Hier stehen die Stundensätze aller Firmen beieinander –
 * was die eine verlangt, geht die andere nichts an. Deshalb requireAdmin und
 * nicht requireSession: Die Sperre sitzt in der Route und nicht nur darin,
 * dass das Register bei Lieferanten nicht angezeigt wird. Ein ausgeblendetes
 * Register ist kein Schloss.
 *
 * Soll ein Lieferant später seine eigenen Stunden erfassen, wird hier auf
 * requireSession umgestellt und die Abfrage auf die eigene supplier_id
 * eingeschränkt. Die Tabelle kann das schon.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, id);

  const { data, error } = await serviceClient()
    .from('time_entries')
    .select(SPALTEN)
    .eq('project_id', id)
    .order('datum', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1000);

  if (error) {
    // Ohne Migration 0041 gibt es die Tabelle noch nicht. Das Register zeigt
    // dann einen Hinweis statt einer Fehlermeldung.
    return ok({ zeiten: [], ohneTabelle: true });
  }

  return ok({ zeiten: (data ?? []) as unknown as Zeiteintrag[] });
});

/** Einen Eintrag anlegen. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, id);

  const body = await readJson<{
    wer?: string;
    supplierId?: string | null;
    adminUserId?: string | null;
    datum?: string;
    stunden?: number;
    stundensatz?: number | null;
    beschreibung?: string | null;
  }>(request);

  const datum = (body.datum ?? '').trim();
  const stunden = Number(body.stunden);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    throw new ApiError('Bitte ein gültiges Datum angeben.');
  }
  // Dieselbe Grenze wie in der Datenbank. Hier wird sie zur lesbaren Meldung,
  // dort bleibt sie als letzte Sicherung stehen.
  if (!Number.isFinite(stunden) || stunden <= 0 || stunden > 24) {
    throw new ApiError('Die Stunden müssen zwischen 0 und 24 liegen.');
  }

  const satz =
    body.stundensatz === null || body.stundensatz === undefined
      ? null
      : Number(body.stundensatz);

  if (satz !== null && (!Number.isFinite(satz) || satz < 0)) {
    throw new ApiError('Der Stundensatz darf nicht negativ sein.');
  }

  // Name und Firma werden mitgeschrieben, nicht nur verlinkt: Wird jemand
  // später umbenannt, stimmt die alte Abrechnung trotzdem.
  let wer = (body.wer ?? '').trim();
  let firma: string | null = null;

  if (body.supplierId) {
    const { data } = await serviceClient()
      .from('suppliers')
      .select('id, name, firma')
      .eq('id', body.supplierId)
      .maybeSingle();

    if (!data) throw new ApiError('Diesen Lieferanten gibt es nicht.');
    const s = data as { name: string | null; firma: string | null };
    wer = wer || supplierLabel(s);
    firma = s.firma?.trim() || null;
  } else if (body.adminUserId) {
    const { data } = await serviceClient()
      .from('admins')
      .select('name, firma')
      .eq('user_id', body.adminUserId)
      .maybeSingle();

    const a = data as { name: string | null; firma: string | null } | null;
    wer = wer || a?.name?.trim() || 'Unbekannt';
    firma = a?.firma?.trim() || null;
  }

  if (!wer) throw new ApiError('Bitte angeben, wer gearbeitet hat.');

  const { data, error } = await serviceClient()
    .from('time_entries')
    .insert({
      project_id: id,
      supplier_id: body.supplierId ?? null,
      admin_user_id: body.adminUserId ?? null,
      wer,
      firma,
      datum,
      stunden,
      stundensatz: satz,
      beschreibung: (body.beschreibung ?? '').trim() || null,
      erfasst_von: ctx.session.name,
    })
    .select(SPALTEN)
    .single();

  if (error) {
    throw new ApiError(
      `Der Eintrag konnte nicht gespeichert werden: ${error.message}. `
      + 'Fehlt Migration 0041?',
      500,
    );
  }

  // Bewusst kein Protokolleintrag und keine Mail: Die Zeiterfassung ist eine
  // Nebenbuchhaltung, kein Vorgang auf der Baustelle. Über jede eingetragene
  // Stunde eine Meldung zu schicken, wäre genau die Art Post, die wir gerade
  // abgeschafft haben.
  return ok({ zeit: data as unknown as Zeiteintrag }, { status: 201 });
});
