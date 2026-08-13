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
