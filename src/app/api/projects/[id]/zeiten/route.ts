import { ApiError, forbidden, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { logActivity } from '@/lib/activity';
import { parseDueDate } from '@/lib/due';
import { serviceClient } from '@/lib/supabase/service';
import type { Ctx } from '@/lib/auth/guards';
import type { ZeitEintrag } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Der Hinweis, der überall erscheint, wenn Migration 0048 noch fehlt. */
const OHNE_MIGRATION =
  'Die Zeiterfassung steht erst nach der Datenbank-Aktualisierung 0048 zur '
  + 'Verfügung.';

/**
 * Darf dieser Lieferant in diesem Projekt Zeit erfassen?
 *
 * Geprüft wird in der Anwendung UND in der Datenbank (Policy aus Migration
 * 0048). Die Spezifikation verlangt beides: Ein ausgeblendetes Register ist
 * kein Schloss.
 */
async function darfErfassen(projectId: string, supplierId: string): Promise<boolean> {
  const { data, error } = await serviceClient()
    .from('project_access')
    .select('zeiterfassung')
    .eq('project_id', projectId)
    .eq('supplier_id', supplierId)
    .maybeSingle();

  if (error) return false;
  return (data as { zeiterfassung?: boolean } | null)?.zeiterfassung === true;
}

/**
 * Die Einträge – wir sehen alle, ein Lieferant nur seine eigenen.
 *
 * Was die andere Firma braucht und was sie verlangt, ist deren Sache.
 */
async function eintraegeLesen(ctx: Ctx, projectId: string): Promise<ZeitEintrag[]> {
  let abfrage = serviceClient()
    .from('time_entries')
    .select(
      'id, project_id, supplier_id, datum, stunden, beschreibung, satz, erfasst_von, created_at',
    )
    .eq('project_id', projectId)
    .order('datum', { ascending: false })
    .order('created_at', { ascending: false });

  if (ctx.session.kind === 'supplier') {
    abfrage = abfrage.eq('supplier_id', ctx.session.supplierId);
  }

  const { data, error } = await abfrage;
  if (error) throw new ApiError(`${OHNE_MIGRATION} (${error.message})`, 400);

  return (data ?? []) as unknown as ZeitEintrag[];
}

/**
 * Alles, was das Register braucht: Einträge, der eigene Ansatz und – für uns –
 * wer freigeschaltet ist.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const istAdmin = ctx.session.kind === 'admin';
  // Einmal festgehalten: Nach einer Zuweisung an eine Hilfsvariable weiss
  // TypeScript weiter unten nicht mehr, dass es eine Lieferantensitzung ist.
  const supplierId = ctx.session.kind === 'supplier' ? ctx.session.supplierId : null;

  if (supplierId) {
    const erlaubt = await darfErfassen(projectId, supplierId);
    if (!erlaubt) {
      throw forbidden('Für dieses Projekt ist die Zeiterfassung nicht freigegeben.');
    }
  }

  const eintraege = await eintraegeLesen(ctx, projectId);

  const db = serviceClient();

  // Die Sätze der Firmen: Ein Lieferant bekommt nur seinen eigenen zu sehen.
  const satzAbfrage = supplierId
    ? db.from('suppliers').select('id, stundensatz').eq('id', supplierId)
    : db.from('suppliers').select('id, stundensatz');

  const saetzeRes = await satzAbfrage;
  const saetze: Record<string, number | null> = {};
  for (const z of ((saetzeRes.error ? [] : (saetzeRes.data ?? [])) as unknown as Array<{
    id: string;
    stundensatz: number | null;
  }>)) {
    saetze[z.id] = z.stundensatz;
  }

  if (supplierId) {
    return ok({
      eintraege,
      saetze,
      meinSatz: saetze[supplierId] ?? null,
      darfErfassen: true,
    });
  }

  if (!istAdmin) return ok({ eintraege, saetze, darfErfassen: false });

  const freigabeRes = await db
    .from('project_access')
    .select('supplier_id, zeiterfassung')
    .eq('project_id', projectId);

  const freigegeben = (
    (freigabeRes.error ? [] : (freigabeRes.data ?? [])) as unknown as Array<{
      supplier_id: string;
      zeiterfassung: boolean | null;
    }>
  )
    .filter((z) => z.zeiterfassung)
    .map((z) => z.supplier_id);

  return ok({ eintraege, saetze, freigegeben, darfErfassen: false });
});

/** Eine Zeile erfassen. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  if (ctx.session.kind !== 'supplier') {
    throw forbidden(
      'Zeit erfasst, wer sie geleistet hat. Wir sehen die Stunden, tragen sie '
        + 'aber nicht für andere ein.',
    );
  }

  const supplierId = ctx.session.supplierId;
  if (!(await darfErfassen(projectId, supplierId))) {
    throw forbidden('Für dieses Projekt ist die Zeiterfassung nicht freigegeben.');
  }

  const body = await readJson<{
    datum?: string;
    stunden?: number | string;
    beschreibung?: string;
  }>(request);

  const datum = parseDueDate(requireString(body.datum, 'Datum', 10));
  const stunden = Number(body.stunden);

  if (!Number.isFinite(stunden) || stunden <= 0 || stunden > 24) {
    throw new ApiError('Bitte eine Stundenzahl zwischen 0 und 24 angeben.');
  }

  const db = serviceClient();

  // Der Satz wird mitgeschrieben: Wer im März zu 95 gearbeitet hat und im
  // Juli auf 105 erhöht, hat im März trotzdem zu 95 gearbeitet.
  const { data: firma } = await db
    .from('suppliers')
    .select('stundensatz')
    .eq('id', supplierId)
    .maybeSingle();

  const satz = (firma as { stundensatz?: number | null } | null)?.stundensatz ?? null;

  const { data, error } = await db
    .from('time_entries')
    .insert({
      project_id: projectId,
      supplier_id: supplierId,
      datum,
      // Auf zwei Stellen: Eine Viertelstunde ist 0.25, und mehr Genauigkeit
      // gibt es auf dem Bau ohnehin nicht.
      stunden: Math.round(stunden * 100) / 100,
      beschreibung: optionalString(body.beschreibung, 500),
      satz,
      erfasst_von: ctx.session.name,
    })
    .select(
      'id, project_id, supplier_id, datum, stunden, beschreibung, satz, erfasst_von, created_at',
    )
    .single();

  if (error) throw new ApiError(`${OHNE_MIGRATION} (${error.message})`, 400);

  /**
   * Bewusst ohne Meldung an alle.
   *
   * Eine erfasste Stunde ist kein Ereignis, von dem jemand erfahren muss –
   * sie steht im Register, und dort schaut man hin, wenn man sie braucht.
   * Bei zwanzig Zeilen am Tag wäre jede Meldung eine zu viel.
   */
  return ok({ eintrag: data as unknown as ZeitEintrag }, { status: 201 });
});

/** Den eigenen Stundensatz setzen – freiwillig. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  if (ctx.session.kind !== 'supplier') {
    throw forbidden('Den Ansatz setzt die Firma selbst.');
  }

  const body = await readJson<{ stundensatz?: number | string | null }>(request);

  let satz: number | null = null;
  if (body.stundensatz !== null && body.stundensatz !== undefined && body.stundensatz !== '') {
    const wert = Number(body.stundensatz);
    if (!Number.isFinite(wert) || wert < 0 || wert > 100000) {
      throw new ApiError('Bitte einen Ansatz in Franken je Stunde angeben.');
    }
    satz = Math.round(wert * 100) / 100;
  }

  const { error } = await serviceClient()
    .from('suppliers')
    .update({ stundensatz: satz })
    .eq('id', ctx.session.supplierId);

  if (error) throw new ApiError(`${OHNE_MIGRATION} (${error.message})`, 400);

  return ok({ stundensatz: satz });
});

/**
 * Freigeben oder entziehen – nur für uns.
 *
 * Wer auf der Baustelle im Stundenlohn arbeitet, erfasst Zeit; wer pauschal
 * offeriert hat, geht das nichts an und sieht das Register gar nicht erst.
 */
export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ supplierId?: string; erlaubt?: boolean }>(request);
  const supplierId = requireString(body.supplierId, 'Lieferant', 64);
  const erlaubt = body.erlaubt !== false;

  const db = serviceClient();

  const { error } = await db
    .from('project_access')
    .update({ zeiterfassung: erlaubt })
    .eq('project_id', projectId)
    .eq('supplier_id', supplierId);

  if (error) throw new ApiError(`${OHNE_MIGRATION} (${error.message})`, 400);

  const { data: firma } = await db
    .from('suppliers')
    .select('name, firma')
    .eq('id', supplierId)
    .maybeSingle();

  const wer =
    (firma as { name?: string | null; firma?: string | null } | null)?.firma?.trim()
    || (firma as { name?: string | null } | null)?.name?.trim()
    || 'Lieferant';

  // Hier schon: Eine Freigabe ist eine Abmachung, keine Nebensache. Wer sie
  // bekommt, soll es erfahren – und wer sie verliert, erst recht.
  const warning = await logActivity(db, {
    projectId,
    actorName: ctx.session.name,
    actorEmail: ctx.session.email,
    text: erlaubt
      ? `hat ${wer} für die Zeiterfassung freigegeben`
      : `hat die Zeiterfassung für ${wer} geschlossen`,
    icon: '⏱️',
    notify: true,
    empfaengerSupplierIds: [supplierId],
  });

  return ok({ ok: true, warning });
});
