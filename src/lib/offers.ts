/**
 * Die vier Ordner im Register "Offerten".
 *
 * Der gespeicherte Wert ist bewusst kurz und ohne Umlaute, damit er sich in
 * Datenbank-Prüfregeln und URLs unauffällig verhält; angezeigt wird der Name.
 */
export const OFFERTEN_ORDNER = [
  {
    wert: 'kostenschaetzung',
    name: 'Kostenschätzungen',
    icon: '🧮',
    hinweis: 'Grobe Annahmen, noch unverbindlich.',
  },
  {
    wert: 'richtofferte',
    name: 'Richtofferten',
    icon: '📐',
    hinweis: 'Preisrahmen ohne verbindliche Zusage.',
  },
  {
    wert: 'offerte',
    name: 'Offerten',
    icon: '📄',
    hinweis: 'Verbindliche Angebote.',
  },
  {
    wert: 'nachtrag',
    name: 'Nachtrag',
    icon: '➕',
    hinweis: 'Zusätzliche Leistungen zur bestehenden Offerte.',
  },
] as const;

export type OffertenOrdner = (typeof OFFERTEN_ORDNER)[number]['wert'];

/** Prüft einen Ordnerwert; alles Unbekannte gilt als "keine Offerte". */
export function pruefeOrdner(wert: unknown): OffertenOrdner | null {
  if (typeof wert !== 'string') return null;
  const treffer = OFFERTEN_ORDNER.find((o) => o.wert === wert.trim());
  return treffer ? treffer.wert : null;
}

/** Anzeigename eines Ordners, z.B. für Protokoll und Kacheln. */
export function ordnerName(wert: string | null | undefined): string | null {
  if (!wert) return null;
  return OFFERTEN_ORDNER.find((o) => o.wert === wert)?.name ?? null;
}
