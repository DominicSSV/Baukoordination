import type { TabKey } from '@/components/workspace/Workspace';

/**
 * Nachrichten über WhatsApp statt über E-Mail.
 *
 * Auf der Baustelle wird WhatsApp gelesen, das Mailfach oft erst am Abend.
 * Der Weg über wa.me braucht weder einen Serverdienst noch eine freigegebene
 * Absenderadresse: Der Browser öffnet WhatsApp mit fertig geschriebener
 * Nachricht, abgeschickt wird sie von Hand. Damit bleibt auch die Kontrolle
 * darüber, was tatsächlich hinausgeht.
 */

/**
 * Aus einer beliebig geschriebenen Telefonnummer die Form machen, die wa.me
 * erwartet: nur Ziffern, mit Landesvorwahl, ohne Plus.
 *
 * "079 123 45 67" wird zu "41791234567". Steht im Feld etwas anderes als eine
 * Nummer ("Büro", "nach 17 Uhr"), kommt null zurück – dann öffnet WhatsApp
 * seine Kontaktauswahl, statt in einen falschen Chat zu springen.
 */
export function waNummer(kontakt: string | null | undefined): string | null {
  if (!kontakt) return null;

  const roh = kontakt.trim();
  // Buchstaben deuten auf eine Notiz hin, nicht auf eine Nummer.
  if (/[a-zA-ZäöüÄÖÜ]/.test(roh)) return null;

  let ziffern = roh.replace(/[^\d+]/g, '');
  if (ziffern.startsWith('+')) ziffern = ziffern.slice(1);
  else if (ziffern.startsWith('00')) ziffern = ziffern.slice(2);
  else if (ziffern.startsWith('0')) ziffern = `41${ziffern.slice(1)}`; // Schweiz

  // Kürzer als eine Landesvorwahl mit Nummer kann nicht stimmen.
  if (ziffern.length < 10 || ziffern.length > 15) return null;
  return ziffern;
}

/**
 * Der Link, der WhatsApp öffnet. Ohne Nummer landet man in der Kontaktauswahl –
 * das ist der richtige Weg, wenn wir die Nummer gar nicht kennen.
 */
export function waLink(text: string, nummer?: string | null): string {
  const ziel = nummer ? `https://wa.me/${nummer}` : 'https://wa.me/';
  return `${ziel}?text=${encodeURIComponent(text)}`;
}

/**
 * Ein Link, der direkt an die richtige Stelle in der App führt.
 *
 * Wer noch nicht angemeldet ist, kommt zuerst auf die Code-Eingabe und wird
 * danach hierher weitergereicht – siehe den Parameter "next" in app/page.tsx.
 */
export function appLink(projectId: string, ziel: TabKey): string {
  const basis =
    typeof window === 'undefined' ? '' : window.location.origin;
  return `${basis}/app?p=${projectId}&t=${ziel}`;
}

/** Der Vorname, damit die Nachricht nicht nach Formular klingt. */
function vorname(name: string | null | undefined): string {
  const erster = (name ?? '').trim().split(/\s+/)[0];
  return erster || 'zusammen';
}

/**
 * Einladung mit den Anmeldedaten – derselbe Inhalt wie die E-Mail-Einladung,
 * nur kurz genug für eine Nachricht.
 */
export function einladungsText(
  name: string | null,
  email: string | null,
  passwort: string | null,
  basis: string,
): string {
  return [
    `Ciao ${vorname(name)}`,
    ``,
    `Du hast Zugriff auf unsere Baukoordination-App.`,
    ``,
    `Link: ${basis}`,
    `E-Mail: ${email ?? '– noch keine hinterlegt –'}`,
    `Passwort: ${passwort ?? '– bitte bei uns nachfragen –'}`,
    ``,
    `Dort siehst du die Projekte, die dir zugeordnet sind. Du kannst To-Dos abhaken, kommentieren und Fotos hinzufügen.`,
    ``,
    `Das Passwort gilt nur für diese App.`,
    ``,
    `Swiss Solar Ventures AG`,
  ].join('\n');
}

/** Eine Aufgabe weitergeben – mit Projekt, Frist und Link an die richtige Stelle. */
export function todoText(
  empfaenger: string | null,
  projekt: string,
  aufgabe: string,
  frist: string | null,
  link: string,
): string {
  return [
    `Ciao ${vorname(empfaenger)}`,
    ``,
    `${projekt}: ${aufgabe}`,
    ...(frist ? [`Termin: ${frist}`] : []),
    ``,
    `In der App: ${link}`,
    ``,
    `Swiss Solar Ventures AG`,
  ].join('\n');
}
