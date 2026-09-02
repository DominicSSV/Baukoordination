import { cookies } from 'next/headers';
import { ApiError, handler, ok, readJson } from '@/lib/api';
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
  'E-Mail oder Passwort stimmt nicht. Die Passwörter vergibt die Swiss Solar ' +
  'Ventures AG – melde dich bei uns, wenn du keines hast.';

/**
 * Der einzige Weg hinein: Mailadresse und das von uns vergebene Passwort.
 *
 * Die Prüfung läuft über service_role, weil zu diesem Zeitpunkt noch keine
 * Identität feststeht. Gesucht wird ausschliesslich über die Adresse, und
 * zurück geht nur, was für die Sitzung gebraucht wird.
 */
async function anmelden(email: string, passwort: string): Promise<Zeile> {
  const adresse = email.trim().toLowerCase();
  if (!adresse || !passwort) throw new ApiError('Bitte E-Mail und Passwort eingeben.');

  const { data, error } = await serviceClient()
    .from('suppliers')
    .select('id, name, firma, passwort_hash')
    .ilike('email', adresse);

  if (error) {
    throw new ApiError(
      'Die Anmeldung ist noch nicht eingerichtet (Datenbank-Aktualisierung 0028 ' +
        'fehlt). Bitte melde dich bei der Swiss Solar Ventures AG.',
      500,
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
 * Anmeldung eines Lieferanten.
 *
 * Der frühere Zugangscode ist abgeschafft: Er war ein zweites Geheimnis, das
 * keine Passwortverwaltung speichert – auf der Baustelle hiess das, den Code
 * jedes Mal aus einer alten Mail zu suchen. Jetzt gibt es einen Weg, und der
 * lässt sich auf dem Handy hinterlegen.
 */
export const POST = handler(async (request: Request) => {
  const body = await readJson<{ email?: string; passwort?: string }>(request);

  const supplier = await anmelden(String(body.email ?? ''), String(body.passwort ?? ''));

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

  return ok({ name: supplierLabel(supplier) });
});
