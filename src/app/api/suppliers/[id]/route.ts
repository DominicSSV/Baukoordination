import { ApiError, handler, ok, optionalString, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { supplierLabel } from '@/lib/auth/session';
import { serviceClient } from '@/lib/supabase/service';
import { hashPasswort, pruefeStaerke } from '@/lib/auth/passwort';
import type { Supplier } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Stammdaten ändern. Der Zugangscode bleibt bewusst unverändert, damit bereits
 *  verschickte Einladungen weiter funktionieren. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{
    name?: string;
    firma?: string;
    gewerk?: string;
    kontakt?: string;
    email?: string;
    mailAn?: boolean;
    passwort?: string;
  }>(request);

  const name = optionalString(body.name, 200);
  const firma = optionalString(body.firma, 200);
  if (!name && !firma) {
    throw new ApiError('Bitte mindestens Firma oder Ansprechperson angeben.');
  }

  /**
   * Ein Passwort für diese Person setzen.
   *
   * Damit kann sie sich sofort mit E-Mail und Passwort anmelden, ohne zuerst
   * über den Zugangscode hereinzukommen. Gedacht für die Einführung: Ihr setzt
   * eines, teilt es mit, und die Person ändert es später selbst im Profil.
   *
   * Gespeichert wird auch hier nur der Prüfwert. Zurücklesen kann ihn niemand –
   * auch wir nicht. Ist ein Passwort vergessen, wird ein neues gesetzt.
   */
  const passwortFelder: Record<string, unknown> = {};
  if (typeof body.passwort === 'string' && body.passwort) {
    const beanstandung = pruefeStaerke(body.passwort);
    if (beanstandung) throw new ApiError(beanstandung);
    passwortFelder.passwort_hash = await hashPasswort(body.passwort);
    passwortFelder.passwort_gesetzt_am = new Date().toISOString();
  }

  const felder = {
    name,
    firma,
    gewerk: optionalString(body.gewerk, 120),
    kontakt: optionalString(body.kontakt, 120),
    email: optionalString(body.email, 200),
  };

  const spalten = 'id, name, firma, gewerk, kontakt, email, access_code, created_at';

  let { data, error } = await ctx.db
    .from('suppliers')
    .update({
      ...felder,
      ...(typeof body.mailAn === 'boolean' ? { mail_an: body.mailAn } : {}),
      ...passwortFelder,
    })
    .eq('id', id)
    .select(spalten)
    .single();

  // Ohne Migration 0027 gibt es die Spalte mail_an noch nicht. Dann sollen
  // wenigstens die übrigen Angaben gespeichert werden, statt dass das Ändern
  // eines Namens an einer fehlenden Spalte scheitert.
  if (error && (typeof body.mailAn === 'boolean' || Object.keys(passwortFelder).length)) {
    ({ data, error } = await ctx.db
      .from('suppliers')
      .update(felder)
      .eq('id', id)
      .select(spalten)
      .single());
  }

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);
  return ok({ supplier: data as Supplier });
});

/** Lieferant komplett löschen – entfernt ihn aus ALLEN Projekten, nicht nur dem aktuellen. */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { data: supplier } = await ctx.db
    .from('suppliers')
    .select('id, name, firma')
    .eq('id', id)
    .maybeSingle();

  if (!supplier) throw new ApiError('Lieferant nicht gefunden.', 404);

  // Der Audit-Eintrag muss vor dem Löschen geschrieben werden: danach räumt
  // ON DELETE SET NULL die supplier_id weg, der Name bleibt im Text erhalten.
  await ctx.db.from('access_audit').insert({
    supplier_id: id,
    action: 'supplier_deleted',
    actor: ctx.session.name,
    detail: `"${supplierLabel(supplier)}" komplett gelöscht (alle Projekte)`,
  });

  // project_access und supplier_sessions hängen per ON DELETE CASCADE mit dran.
  const { error } = await ctx.db.from('suppliers').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  // Sicherheitsnetz, falls die Sitzungstabelle einmal ohne Cascade angelegt wurde.
  await serviceClient().from('supplier_sessions').delete().eq('supplier_id', id);

  return ok({ ok: true, name: supplierLabel(supplier) });
});
