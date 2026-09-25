import { PLAN_FARBEN, pruefeFarbe } from '@/lib/schedule';

/**
 * Die Farbe einer Projektgruppe.
 *
 * Steht eine in der Datenbank, gilt die. Sonst wird eine aus dem Namen
 * abgeleitet – damit die Sparten auch ohne Migration 0045 unterscheidbar
 * sind und eine neu angelegte Gruppe sofort eine Farbe hat, statt bis zum
 * ersten Auswählen grau zu bleiben.
 *
 * Abgeleitet wird über eine Quersumme der Zeichen. Das ist keine schöne
 * Zuordnung – "Heizung" kann blau herauskommen –, aber eine verlässliche:
 * Derselbe Name ergibt immer dieselbe Farbe, auf jedem Gerät und nach jedem
 * Neuladen. Eine zufällige Farbe wäre beim nächsten Öffnen eine andere, und
 * dann trennt sie nichts mehr.
 */
export function gruppenFarbe(gruppe: {
  name: string;
  farbe?: string | null;
}): string {
  if (gruppe.farbe) return pruefeFarbe(gruppe.farbe, PLAN_FARBEN[0].wert);

  let summe = 0;
  for (const zeichen of gruppe.name.trim().toLowerCase()) {
    summe += zeichen.codePointAt(0) ?? 0;
  }

  return PLAN_FARBEN[summe % PLAN_FARBEN.length].wert;
}
