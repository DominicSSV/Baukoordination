/**
 * Wochentage, an denen jemand vor Ort ist.
 *
 * Gezählt wird wie ISO es tut: 1 = Montag … 7 = Sonntag. Nicht wie JavaScript
 * mit 0 = Sonntag – wer eine Woche aufzählt, fängt hier am Montag an, und eine
 * Liste, die mit dem Sonntag beginnt, liest auf der Baustelle niemand richtig.
 *
 * Eine leere Liste heisst ausdrücklich "immer vor Ort" und nicht "nie". Das ist
 * die richtige Voreinstellung: Die allermeisten Kontakte haben keine feste
 * Anwesenheit, und wer versehentlich als "nie da" gälte, wäre schlimmer dran
 * als einer ganz ohne Angabe.
 */

export const WOCHENTAGE: Array<{ nummer: number; kurz: string; lang: string }> = [
  { nummer: 1, kurz: 'Mo', lang: 'Montag' },
  { nummer: 2, kurz: 'Di', lang: 'Dienstag' },
  { nummer: 3, kurz: 'Mi', lang: 'Mittwoch' },
  { nummer: 4, kurz: 'Do', lang: 'Donnerstag' },
  { nummer: 5, kurz: 'Fr', lang: 'Freitag' },
  { nummer: 6, kurz: 'Sa', lang: 'Samstag' },
  { nummer: 7, kurz: 'So', lang: 'Sonntag' },
];

/** Heutiger Wochentag als 1–7. */
export function heutigerTag(): number {
  const js = new Date().getDay(); // 0 = Sonntag
  return js === 0 ? 7 : js;
}

/**
 * Aus beliebiger Eingabe eine saubere Tagesliste machen: aufsteigend, ohne
 * Doppelte, ohne Unsinn.
 *
 * Sind alle sieben Tage angewählt, kommt eine leere Liste zurück: "jeden Tag"
 * und "immer" sind dasselbe, und zwei Schreibweisen für denselben Sachverhalt
 * führen später zu zwei verschiedenen Anzeigen.
 */
export function saubereTage(wert: unknown): number[] {
  if (!Array.isArray(wert)) return [];

  const zahlen = wert
    .map((t) => (typeof t === 'number' ? t : Number.parseInt(String(t), 10)))
    .filter((t) => Number.isInteger(t) && t >= 1 && t <= 7);

  const eindeutig = [...new Set(zahlen)].sort((a, b) => a - b);
  return eindeutig.length === 7 ? [] : eindeutig;
}

/** Ist die Person heute da? Ohne Angabe: ja. */
export function istHeuteVorOrt(tage: number[] | null | undefined): boolean {
  if (!tage || !tage.length) return true;
  return tage.includes(heutigerTag());
}

/**
 * Die Tage als Text, wie man sie sagen würde: "Mo, Mi, Fr".
 *
 * Zusammenhängende Tage werden zusammengezogen ("Mo–Fr"): Fünf Kürzel
 * hintereinander liest niemand, eine Spanne schon.
 */
export function tageText(tage: number[] | null | undefined): string {
  if (!tage || !tage.length) return 'immer vor Ort';

  const kurz = (n: number) => WOCHENTAGE.find((t) => t.nummer === n)?.kurz ?? String(n);
  const sortiert = [...tage].sort((a, b) => a - b);

  const teile: string[] = [];
  let start = sortiert[0];
  let vorher = sortiert[0];

  for (const tag of sortiert.slice(1).concat(0)) {
    // Die angehängte 0 bricht die letzte Spanne ab, ohne den Block zu wiederholen.
    if (tag === vorher + 1) {
      vorher = tag;
      continue;
    }

    // Erst ab drei Tagen lohnt die Spanne: "Mo–Di" ist nicht kürzer als "Mo, Di".
    if (vorher - start >= 2) teile.push(`${kurz(start)}–${kurz(vorher)}`);
    else for (let n = start; n <= vorher; n += 1) teile.push(kurz(n));

    start = tag;
    vorher = tag;
  }

  return teile.join(', ');
}
