/**
 * Die vier Ordner im Register "Offerten".
 *
 * Der gespeicherte Wert ist bewusst kurz und ohne Umlaute, damit er sich in
 * Datenbank-Prüfregeln und URLs unauffällig verhält; angezeigt wird der Name.
 */
/**
 * Die Ordner, in die eingereicht wird.
 *
 * Frueher waren es fuenf. Uebrig bleiben die beiden, die auf der Baustelle
 * wirklich zirkulieren: die Bestaetigung eines erteilten Auftrags und der
 * Nachtrag dazu. Kostenschaetzungen, Richtofferten und Offerten liefen ueber
 * andere Wege ohnehin nebenher.
 */
export const OFFERTEN_ORDNER = [
  {
    wert: 'auftragsbestaetigung',
    name: 'Auftragsbestätigungen',
    icon: '✅',
    hinweis: 'Bestätigung des erteilten Auftrags.',
  },
  {
    wert: 'nachtrag',
    name: 'Nachträge',
    icon: '➕',
    hinweis: 'Zusätzliche Leistungen zum bestehenden Auftrag.',
  },
] as const;

/**
 * Was frueher hier stand.
 *
 * Diese Ordner nimmt niemand mehr entgegen, aber was darin liegt, bleibt
 * liegen. Ein Dokument verschwinden zu lassen, weil wir die Gliederung
 * geaendert haben, waere das Schlimmste: Wer es sucht, findet es nie wieder
 * und weiss nicht einmal, dass es das gab.
 *
 * Die App zeigt einen solchen Ordner weiterhin an, solange etwas darin liegt –
 * mit dem Vermerk "frueher" und ohne die Moeglichkeit, neu einzureichen.
 */
export const FRUEHERE_ORDNER = [
  { wert: 'kostenschaetzung', name: 'Kostenschätzungen', icon: '🧮' },
  { wert: 'richtofferte', name: 'Richtofferten', icon: '📐' },
  { wert: 'offerte', name: 'Offerten', icon: '📄' },
] as const;

/** Alle Ordnerwerte, die es je gab – fuer Namen und Pruefung. */
export const ALLE_ORDNER = [...OFFERTEN_ORDNER, ...FRUEHERE_ORDNER] as const;

export type OffertenOrdner = (typeof OFFERTEN_ORDNER)[number]['wert'];

/**
 * Prueft einen Ordnerwert fuer eine NEUE Einreichung.
 *
 * Nur die aktiven Ordner. Ein frueherer Wert wird abgelehnt – sonst liesse
 * sich ueber die Schnittstelle weiter in einen Ordner einreichen, den es in
 * der Ansicht gar nicht mehr gibt.
 */
export function pruefeOrdner(wert: unknown): OffertenOrdner | null {
  if (typeof wert !== 'string') return null;
  const treffer = OFFERTEN_ORDNER.find((o) => o.wert === wert.trim());
  return treffer ? treffer.wert : null;
}

/** Ist das ein Ordner, den es frueher gab? */
export function istFruehererOrdner(wert: string | null | undefined): boolean {
  return FRUEHERE_ORDNER.some((o) => o.wert === wert);
}

/**
 * Firmenname auf eine vergleichbare Form bringen. Gross-/Kleinschreibung und
 * Leerzeichen sollen nicht darüber entscheiden, wer zusammengehört; ohne
 * Firmeneintrag gibt es keine Zugehörigkeit (null).
 */
export function firmaSchluessel(firma: string | null | undefined): string | null {
  const wert = (firma ?? '').trim().toLowerCase();
  return wert || null;
}

/** Anzeigename eines Ordners, z.B. für Protokoll und Kacheln. */
export function ordnerName(wert: string | null | undefined): string | null {
  if (!wert) return null;
  // Auch die frueheren Ordner: Ein Protokolleintrag von damals soll nicht
  // ploetzlich ohne Ordnernamen dastehen.
  return ALLE_ORDNER.find((o) => o.wert === wert)?.name ?? null;
}
