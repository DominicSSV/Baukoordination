/**
 * Der Bauherrenvertreter ist immer die Swiss Solar Ventures AG. In der Oberfläche
 * erscheint deshalb überall der Firmenname statt der Rollenbezeichnung – sowohl bei
 * der Zuweisung von Aufgaben als auch in den Texten für Lieferanten.
 *
 * Zentral hinterlegt, damit eine spätere Umbenennung an einer Stelle genügt.
 */
export const INTERNAL_PARTY = 'Swiss Solar Ventures AG';

/** Wert in der Spalte todos.assigned_to für eine interne Aufgabe. */
export const INTERNAL_ASSIGNEE = 'internal';

/**
 * Urheberschaft und Rechte an dieser App.
 *
 * An einer Stelle hinterlegt, weil dieselbe Angabe an vier Orten auftaucht: im
 * Dialog "Über diese App", auf der Anmeldeseite, in der Fusszeile jeder Mail
 * und in der Lizenzdatei. Stünden sie einzeln im Code, wären sie nach der
 * ersten Änderung verschieden – und eine Rechteangabe, die sich widerspricht,
 * ist keine.
 */
export const APP_NAME = 'Baukoordination';

/**
 * Die angezeigte Fassung.
 *
 * Steht hier und nicht in package.json, weil die Datei im Browser nicht zur
 * Verfügung steht – und weil die Zahl im Dialog ohnehin die ist, die man am
 * Telefon durchgibt, wenn etwas nicht stimmt.
 */
export const APP_VERSION = '1.0';

/** Wer die App entwickelt hat und wem sie gehört. */
export const APP_AUTOR = 'Dominic Maag';
export const APP_INHABER = INTERNAL_PARTY;

/**
 * Das Jahr im Rechtevermerk.
 *
 * Bewusst fest und nicht aus der Uhr des Servers: Ein Vermerk, der jedes Jahr
 * von selbst weiterspringt, weist nicht mehr auf das Jahr der Erstellung hin.
 */
export const APP_JAHR = 2026;

export const APP_RECHTE = `© ${APP_JAHR} ${APP_INHABER}. Alle Rechte vorbehalten.`;

/** Eine Zeile, wie sie unter einem Anmeldefenster oder in einer Mail steht. */
export const APP_HERKUNFT = `Eine Entwicklung von ${APP_AUTOR}, ${APP_INHABER}.`;
