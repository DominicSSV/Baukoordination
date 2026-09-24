/**
 * Worum es in einer Protokollzeile geht.
 *
 * Die Zeilen lauten "hat To-Do „Kran bestellen" als erledigt markiert" oder
 * "hat zu To-Do „Kran bestellen" kommentiert: ...". In Anführungszeichen steht
 * also der Betreff – die Aufgabe, um die es geht.
 *
 * Das Protokoll hält keine Kennung der Aufgabe fest, nur ihren Text. Deshalb
 * wird er hier herausgelesen, um die Aufgabe in der Liste wiederzufinden und
 * kurz hervorzuheben. Das ist bewusst eine Annäherung: Heissen zwei Aufgaben
 * genau gleich, wird die erste hervorgehoben. Das ist harmlos – hervorheben
 * ändert nichts, es zeigt nur hin.
 *
 * Beim Kommentar steht hinter dem Betreff noch der Kommentartext, ebenfalls in
 * Anführungszeichen. Deshalb zählt das ERSTE Paar.
 */
export function betreffAusText(text: string): string | null {
  // Gerade und typografische Anführungszeichen, beide Richtungen.
  const treffer = text.match(/[„"“']([^„"“']{2,200})[""“']/);
  return treffer ? treffer[1].trim() || null : null;
}
