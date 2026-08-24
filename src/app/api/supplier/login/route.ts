import { cookies } from 'next/headers';
import { ApiError, handler, ok, readJson } from '@/lib/api';
import { normalizeCode } from '@/lib/codes';
import { createSupplierSession, supplierLabel } from '@/lib/auth/session';
import { pruefePasswort } from '@/lib/auth/passwort';
import { serviceClient } from '@/lib/supabase/service';
import { SUPPLIER_COOKIE, SUPPLIER_SESSION_DAYS } from '@/lib/env';

export const dynamic = 'force-dynamic';

type Zeile = {
  id: string;
  name: string | null;
  firma: string | null;
  passwort_hash?: string | null;
};

/**
 * Absichtlich derselbe Text für "Adresse unbekannt" und "Passwort falsch".
 *
 * Wären die Meldungen verschieden, liesse sich damit herausfinden, welche
 * Firmen bei uns hinterlegt sind – auch ohne je hineinzukommen.
 */
const ABGELEHNT =
  'E-Mail oder Passwort stimmt nicht. Hast du noch kein Passwort gesetzt, ' +
  'melde dich mit deinem Zugangscode an.';

/** Anmeldung über die Mailadresse und das selbst gesetzte Passwort. */
async function perPasswort(email: string, passwort: string): Promise<Zeile> {
  const adresse = email.trim().toLowerCase();
  if (!adresse || !passwort) throw new ApiError('Bitte E-Mail und Passwort eingeben.');

  const { data, error } = await serviceClient()
    .from('suppliers')
    .select('id, name, firma, passwort_hash')
    .ilike('email', adresse);

  if (error) {
    throw new ApiError(
      'Die Anmeldung mit Passwort ist noch nicht eingerichtet. Bitte melde dich ' +
        'mit deinem Zugangscode an.',
      400,
    );
  }

  const treffer = (data ?? []) as Zeile[];

  // Zwei Einträge mit derselben Adresse: Dann ist nicht entscheidbar, wer
  // gemeint ist. Lieber niemanden anmelden als die falsche Person.
  if (treffer.length > 1) {
    throw new ApiError(
      'Diese Adresse ist mehrfach hinterlegt. Bitte melde dich bei der Swiss ' +
        'Solar Ventures AG – wir bereinigen das.',
      409,
    );
  }

  const zeile = treffer[0];

  // Auch ohne Treffer wird gerechnet: Sonst verriete die Antwortzeit, ob es
  // die Adresse überhaupt gibt.
  const stimmt = await pruefePasswort(passwort, zeile?.passwort_hash ?? null);
  if (!zeile || !stimmt) throw new ApiError(ABGELEHNT, 401);

  return zeile;
}

/**
 * Anmeldung per Zugangscode. Die Prüfung läuft bewusst über service_role, weil zu
 * diesem Zeitpunkt noch keine Identität feststeht – gefunden wird ausschliesslich
 * über den exakten Code, es wird nichts anderes aus der Tabelle zurückgegeben.
 */
async function perCode(code: string): Promise<Zeile> {
  const normalized = normalizeCode(code);
  if (!normalized) throw new ApiError('Bitte gib deinen Zugangscode ein.');

  const db = serviceClient();

  // passwort_hash wird nur gelesen, um danach zum Setzen eines Passworts
  // aufzufordern. Ohne Migration 0028 gibt es die Spalte nicht – dann läuft
  // die Anmeldung wie bisher, nur ohne diese Aufforderung.
  let { data: supplier, error } = await db
    .from('suppliers')
    .select('id, name, firma, passwort_hash')
    .eq('access_code', normalized)
    .maybeSingle();

  if (error) {
    ({ data: supplier, error } = await db
      .from('suppliers')
      .select('id, name, firma')
      .eq('access_code', normalized)
      .maybeSingle());
  }

  if (error) throw new ApiError(`Anmeldung fehlgeschlagen: ${error.message}`, 500);
  if (!supplier) {
    throw new ApiError(
      'Code ungültig. Bitte bei der Swiss Solar Ventures AG nachfragen.',
      401,
    );
  }

  return supplier as Zeile;
}

/**
 * Zwei Wege hinein, ein Ergebnis.
 *
 * Der Zugangscode bleibt: Er ist der Weg hinein, bevor es ein Passwort gibt,
 * und die Rettung, wenn jemand es vergisst. Das Passwort gibt es, weil ein
 * gewöhnliches Codefeld von keiner Passwortverwaltung gespeichert wird – auf
 * der Baustelle hiess das, den Code jedes Mal aus der alten Mail zu suchen.
 */
export const POST = handler(async (request: Request) => {
  const body = await readJson<{ code?: string; email?: string; passwort?: string }>(
    request,
  );

  const supplier = body.email
    ? await perPasswort(String(body.email), String(body.passwort ?? ''))
    : await perCode(String(body.code ?? ''));

  const userAgent = request.headers.get('user-agent');
  const token = await createSupplierSession(supplier.id, userAgent);

  const store = await cookies();
  store.set(SUPPLIER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SUPPLIER_SESSION_DAYS * 24 * 60 * 60,
  });

  return ok({
    name: supplierLabel(supplier),
    // Nach der Anmeldung mit Code soll die App auffordern, ein Passwort zu
    // setzen – sonst bleibt es beim Suchen in alten Mails.
    ohnePasswort:
      !body.email && supplier.passwort_hash !== undefined && !supplier.passwort_hash,
  });
});
