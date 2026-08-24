import 'server-only';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Passwörter für die Anmeldung der Lieferanten.
 *
 * Gespeichert wird nie das Passwort, sondern ein Prüfwert daraus. Verwendet
 * wird scrypt aus der Node-Standardbibliothek – kein zusätzliches Paket, und
 * bewusst ein Verfahren, das absichtlich langsam rechnet: Wer die Tabelle in
 * die Hände bekommt, kann nicht in kurzer Zeit Millionen Passwörter
 * durchprobieren.
 *
 * Jede Person bekommt ein eigenes Zufallssalz. Zwei Personen mit demselben
 * Passwort haben deshalb verschiedene Prüfwerte, und eine fertige Tabelle
 * vorberechneter Werte nützt einem Angreifer nichts.
 *
 * Format: scrypt$<Salz in Hex>$<Prüfwert in Hex>. Das Verfahren steht mit im
 * Wert, damit sich später ein stärkeres einführen lässt, ohne dass alte
 * Anmeldungen brechen.
 */

const SCHLUESSEL_LAENGE = 64;

/** Kürzer ist auf einer Baustelle sinnlos zu erraten, aber leicht zu tippen. */
export const MIN_LAENGE = 8;

function ableiten(klartext: string, salz: Buffer): Promise<Buffer> {
  return new Promise((erfuellen, ablehnen) => {
    scrypt(klartext.normalize('NFKC'), salz, SCHLUESSEL_LAENGE, (fehler, wert) =>
      fehler ? ablehnen(fehler) : erfuellen(wert),
    );
  });
}

export async function hashPasswort(klartext: string): Promise<string> {
  const salz = randomBytes(16);
  const wert = await ableiten(klartext, salz);
  return `scrypt$${salz.toString('hex')}$${wert.toString('hex')}`;
}

/**
 * Stimmt das Passwort?
 *
 * Verglichen wird zeitkonstant. Ein gewöhnlicher Vergleich bricht beim ersten
 * abweichenden Zeichen ab; aus der Dauer liesse sich der richtige Wert
 * Zeichen für Zeichen erraten.
 */
export async function pruefePasswort(
  klartext: string,
  gespeichert: string | null,
): Promise<boolean> {
  if (!gespeichert) return false;

  const teile = gespeichert.split('$');
  if (teile.length !== 3 || teile[0] !== 'scrypt') return false;

  try {
    const salz = Buffer.from(teile[1], 'hex');
    const erwartet = Buffer.from(teile[2], 'hex');
    if (!salz.length || erwartet.length !== SCHLUESSEL_LAENGE) return false;

    const wert = await ableiten(klartext, salz);
    return timingSafeEqual(wert, erwartet);
  } catch {
    // Ein unlesbarer Eintrag ist kein Grund für einen Absturz – dann stimmt
    // das Passwort eben nicht, und der Zugangscode führt weiterhin hinein.
    return false;
  }
}

/** Was ein Passwort mindestens erfüllen muss. Null = in Ordnung. */
export function pruefeStaerke(klartext: string): string | null {
  if (klartext.length < MIN_LAENGE) {
    return `Das Passwort muss mindestens ${MIN_LAENGE} Zeichen haben.`;
  }
  if (klartext.length > 200) return 'Das Passwort ist zu lang.';
  if (!klartext.trim()) return 'Das Passwort darf nicht nur aus Leerzeichen bestehen.';
  return null;
}
