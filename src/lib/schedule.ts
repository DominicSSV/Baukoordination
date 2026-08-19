/** Farben und Zeitraum-Helfer für den Terminplan. */

/** Auswahl im Bearbeiten-Fenster, angelehnt an den bisherigen Excel-Plan. */
export const PLAN_FARBEN: Array<{ wert: string; name: string }> = [
  { wert: '#00BF63', name: 'Grün' },
  { wert: '#FFBD59', name: 'Gelb' },
  { wert: '#00B0F0', name: 'Hellblau' },
  { wert: '#0070C0', name: 'Blau' },
  { wert: '#C00000', name: 'Rot' },
  { wert: '#FFC000', name: 'Orange' },
  { wert: '#7030A0', name: 'Violett' },
  { wert: '#929291', name: 'Grau' },
];

/**
 * Nur Farbwerte in der Form #RRGGBB zulassen. Der Wert wird direkt als Stil
 * gesetzt, deshalb darf dort nichts anderes durchrutschen.
 */
export function pruefeFarbe(value: unknown, fallback = '#00BF63'): string {
  if (typeof value !== 'string') return fallback;
  const wert = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(wert) ? wert.toUpperCase() : fallback;
}

/** Weiss oder Schwarz als Schriftfarbe – je nachdem, was besser lesbar ist. */
export function schriftfarbeAuf(hintergrund: string): string {
  const hex = hintergrund.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // Wahrgenommene Helligkeit nach der üblichen Gewichtung.
  const helligkeit = (r * 299 + g * 587 + b * 114) / 1000;
  return helligkeit > 150 ? '#262624' : '#FFFFFF';
}

/**
 * Kalenderwoche nach ISO 8601 – so zählt man sie in der Schweiz.
 * Woche 1 ist die Woche mit dem ersten Donnerstag des Jahres.
 */
export function kalenderwoche(datum: string): number {
  const d = new Date(`${datum}T00:00:00Z`);
  const wochentag = (d.getUTCDay() + 6) % 7; // Montag = 0
  d.setUTCDate(d.getUTCDate() - wochentag + 3); // Donnerstag dieser Woche

  const ersterDonnerstag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const versatz = (ersterDonnerstag.getUTCDay() + 6) % 7;
  ersterDonnerstag.setUTCDate(ersterDonnerstag.getUTCDate() - versatz + 3);

  return 1 + Math.round((d.getTime() - ersterDonnerstag.getTime()) / (7 * 86_400_000));
}

export function tagPlus(datum: string, tage: number): string {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

/** Anzahl Tage von a bis b, beide eingeschlossen. */
export function tageZwischen(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * Zeitraum einer Arbeit in Kurzform: "14.09." oder "14.09.–18.09.2026".
 *
 * Steht in Protokoll und Benachrichtigung – dort zählt, wann jemand auf der
 * Baustelle sein muss, nicht das vollständige Datum.
 */
export function fmtPlanDatum(start: string, ende: string): string {
  const zeigen = (iso: string, mitJahr: boolean) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString('de-CH', {
      day: '2-digit',
      month: '2-digit',
      ...(mitJahr ? { year: 'numeric' } : {}),
    });

  return start === ende ? zeigen(start, true) : `${zeigen(start, false)}–${zeigen(ende, true)}`;
}
