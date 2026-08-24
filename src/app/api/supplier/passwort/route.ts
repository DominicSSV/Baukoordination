import { ApiError, handler, ok, readJson } from '@/lib/api';
import { requireSession } from '@/lib/auth/guards';
import { hashPasswort, pruefeStaerke } from '@/lib/auth/passwort';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/**
 * Sein eigenes Passwort setzen oder ändern.
 *
 * Wer hier ankommt, ist bereits angemeldet – über den Zugangscode oder mit dem
 * bisherigen Passwort. Ein zusätzliches Abfragen des alten Passworts brächte
 * deshalb nichts: Wer die Sitzung hat, käme ohnehin auch über den Zugangscode
 * an ein neues.
 *
 * Geändert wird ausschliesslich die eigene Zeile; die Kennung stammt aus der
 * Sitzung, nicht aus der Anfrage.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireSession();

  if (ctx.session.kind !== 'supplier') {
    throw new ApiError(
      'Dieser Weg ist für Lieferanten. Bei uns läuft die Anmeldung über den ' +
        'Anmeldedienst.',
      400,
    );
  }

  const { passwort } = await readJson<{ passwort?: string }>(request);
  const klartext = String(passwort ?? '');

  const beanstandung = pruefeStaerke(klartext);
  if (beanstandung) throw new ApiError(beanstandung);

  const { error } = await serviceClient()
    .from('suppliers')
    .update({
      passwort_hash: await hashPasswort(klartext),
      passwort_gesetzt_am: new Date().toISOString(),
    })
    .eq('id', ctx.session.supplierId);

  if (error) {
    throw new ApiError(
      'Passwörter sind erst nach der Datenbank-Aktualisierung 0028 möglich: ' +
        error.message,
      400,
    );
  }

  return ok({ ok: true });
});

/** Das eigene Passwort wieder entfernen – dann gilt nur noch der Zugangscode. */
export const DELETE = handler(async () => {
  const ctx = await requireSession();

  if (ctx.session.kind !== 'supplier') {
    throw new ApiError('Dieser Weg ist für Lieferanten.', 400);
  }

  const { error } = await serviceClient()
    .from('suppliers')
    .update({ passwort_hash: null, passwort_gesetzt_am: null })
    .eq('id', ctx.session.supplierId);

  if (error) throw new ApiError(`Entfernen fehlgeschlagen: ${error.message}`, 500);
  return ok({ ok: true });
});
