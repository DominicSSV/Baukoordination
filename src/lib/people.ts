import { parseAssignee } from '@/lib/assignee';
import { supplierLabel } from '@/lib/format';
import { INTERNAL_PARTY } from '@/lib/branding';
import type { AdminProfile, Supplier } from '@/types';

export type Person = {
  name: string;
  /** Firma, für die diese Person arbeitet – bei uns immer die Swiss Solar Ventures AG. */
  firma: string | null;
  avatarUrl: string | null;
};

/**
 * Name mit Firma, z.B. „Stive Meier (Melintec AG)“.
 *
 * Auf einer Baustelle sind mehrere Firmen unterwegs; der blosse Vorname sagt
 * niemandem, mit wem man es zu tun hat. Steht als Name ohnehin schon die Firma
 * (Lieferant ohne Ansprechperson), bleibt sie einfach stehen.
 */
export function mitFirma(name: string, firma: string | null | undefined): string {
  const f = firma?.trim();
  if (!f) return name;
  if (name.trim().toLowerCase() === f.toLowerCase()) return name;
  return `${name} (${f})`;
}

/** Kurzform für eine bereits ermittelte Person. */
export function personLabel(person: Person): string {
  return mitFirma(person.name, person.firma);
}

/** Überschrift für alle, bei denen keine Firma hinterlegt ist. */
export const OHNE_FIRMA = 'Ohne Firma';

/**
 * Vergleichsform eines Firmennamens.
 *
 * Gross- und Kleinschreibung und doppelte Leerzeichen fallen weg. Wer einen
 * neuen Mitarbeiter mit "melintec ag" statt "Melintec AG" erfasst, soll in
 * derselben Gruppe landen und nicht eine zweite danebenstellen.
 *
 * Bewusst keine weitergehende Angleichung: "Melintec" und "Melintec AG" bleiben
 * zwei Firmen. Die Rechtsform wegzurechnen würde irgendwann zwei Betriebe
 * zusammenwerfen, die wirklich verschieden sind – und das fiele erst auf, wenn
 * jemand eine Offerte sieht, die ihn nichts angeht.
 */
export function firmenSchluessel(firma: string | null | undefined): string {
  return (firma ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Personen nach ihrer Firma gruppieren – alphabetisch, "Ohne Firma" zuletzt.
 *
 * Die Gruppen entstehen aus den Daten und nicht aus einer gepflegten Liste:
 * Kommt eine Firma zum Projekt, ist ihre Überschrift beim nächsten Öffnen da;
 * geht die letzte Person, verschwindet sie wieder. Eine Liste, die von Hand
 * nachgeführt werden müsste, wäre nach dem zweiten Projekt falsch.
 *
 * Als Überschrift gilt die Schreibweise, die zuerst vorkommt. Steht dieselbe
 * Firma zweimal verschieden geschrieben in der Datenbank, gewinnt also die
 * alphabetisch erste – beide Leute stehen aber zusammen, und darauf kommt es an.
 */
export function nachFirmen<T>(
  leute: T[],
  firmaVon: (person: T) => string | null | undefined,
): Array<{ firma: string; leute: T[] }> {
  const gruppen = new Map<string, { firma: string; leute: T[] }>();

  for (const person of leute) {
    const roh = firmaVon(person)?.trim();
    const schluessel = firmenSchluessel(roh);
    const vorhanden = gruppen.get(schluessel);

    if (vorhanden) {
      vorhanden.leute.push(person);
      continue;
    }

    gruppen.set(schluessel, { firma: roh || OHNE_FIRMA, leute: [person] });
  }

  return Array.from(gruppen.values()).sort((a, b) => {
    // Ohne Firma ganz nach unten: Das ist eine Sammelstelle und keine Firma.
    if (a.firma === OHNE_FIRMA) return 1;
    if (b.firma === OHNE_FIRMA) return -1;
    return a.firma.localeCompare(b.firma, 'de-CH');
  });
}

/**
 * Findet zu einer Person das Profilbild.
 *
 * Protokoll, Kommentare und Dateien halten den Urheber als Namen fest, teils mit
 * Lieferanten-ID. Über die ID ist die Zuordnung eindeutig; sonst wird über den
 * Namen gesucht. Das genügt, weil die Namen der Bauherrenvertreter fest
 * hinterlegt sind – nur wenn jemand später umbenannt wird, bleiben ältere
 * Einträge ohne Bild. Sie zeigen dann wie bisher die Initialen.
 */
export function findPerson(
  quelle: { admins: AdminProfile[]; suppliers: Supplier[] },
  gesucht: { name?: string | null; supplierId?: string | null },
): Person {
  const name = gesucht.name?.trim() ?? '';

  if (gesucht.supplierId) {
    const s = quelle.suppliers.find((x) => x.id === gesucht.supplierId);
    if (s) {
      return {
        name: name || supplierLabel(s),
        firma: s.firma ?? null,
        avatarUrl: s.avatar_url ?? null,
      };
    }
  }

  if (!name) return { name: 'Unbekannt', firma: null, avatarUrl: null };

  const klein = name.toLowerCase();

  const admin = quelle.admins.find((a) => a.name.trim().toLowerCase() === klein);
  if (admin) {
    return { name, firma: admin.firma ?? INTERNAL_PARTY, avatarUrl: admin.avatar_url ?? null };
  }

  const supplier = quelle.suppliers.find(
    (s) => supplierLabel(s).toLowerCase() === klein || s.firma?.trim().toLowerCase() === klein,
  );
  if (supplier) {
    return { name, firma: supplier.firma ?? null, avatarUrl: supplier.avatar_url ?? null };
  }

  return { name, firma: null, avatarUrl: null };
}

/** Zuständiger einer Aufgabe als Person – inklusive Bild und Funktion. */
export function assigneePerson(
  quelle: { admins: AdminProfile[]; suppliers: Supplier[] },
  assignedTo: string | null | undefined,
): Person & { funktion: string | null } {
  const ziel = parseAssignee(assignedTo);

  if (ziel.kind === 'admin') {
    const a = quelle.admins.find((x) => x.user_id === ziel.id);
    if (a) {
      return {
        name: a.name,
        firma: a.firma ?? INTERNAL_PARTY,
        avatarUrl: a.avatar_url ?? null,
        funktion: a.funktion,
      };
    }
    return { name: INTERNAL_PARTY, firma: null, avatarUrl: null, funktion: null };
  }

  if (ziel.kind === 'supplier') {
    const s = quelle.suppliers.find((x) => x.id === ziel.id);
    if (s) {
      return {
        name: supplierLabel(s),
        firma: s.firma ?? null,
        avatarUrl: s.avatar_url ?? null,
        funktion: null,
      };
    }
    return { name: 'Unbekannt', firma: null, avatarUrl: null, funktion: null };
  }

  return { name: INTERNAL_PARTY, firma: null, avatarUrl: null, funktion: null };
}
