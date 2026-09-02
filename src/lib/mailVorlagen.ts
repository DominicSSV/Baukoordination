import 'server-only';
import { serviceClient } from '@/lib/supabase/service';

/**
 * Die Texte der verschickten Mails – anpassbar in der App.
 *
 * Hier stehen nur die Standardfassungen. Wurde ein Text in der App geändert,
 * liegt er in der Tabelle mail_templates und hat Vorrang. Fehlt die Tabelle
 * (Migration 0025 nicht eingespielt) oder ist eine Vorlage gelöscht, greift
 * wieder der Standard – die App verschickt also nie leere Post.
 *
 * Die Platzhalter in geschweiften Klammern setzt die App beim Versenden ein.
 * Ein unbekannter Platzhalter bleibt unverändert stehen, statt zu verschwinden:
 * So sieht man den Tippfehler in der Mail, statt sich über eine Lücke zu wundern.
 */
export type VorlagenSchluessel =
  | 'einladung'
  | 'benachrichtigung'
  | 'update'
  | 'fristablauf';

export type Vorlage = {
  schluessel: VorlagenSchluessel;
  /** Überschrift in der Verwaltung – nicht Teil der Mail. */
  name: string;
  beschreibung: string;
  betreff: string;
  text: string;
  /** Welche Platzhalter hier etwas bewirken. */
  platzhalter: Array<{ name: string; erklaerung: string }>;
};

export const STANDARD_VORLAGEN: Vorlage[] = [
  {
    schluessel: 'einladung',
    name: 'Einladung an einen Lieferanten',
    beschreibung:
      'Geht raus, wenn du bei einem Lieferanten auf „Einladen“ drückst. '
      + 'Enthält die Anmeldedaten.',
    betreff: 'Zugriff auf Baukoordination-App / Swiss Solar Ventures AG',
    text: [
      'Ciao {vorname}',
      '',
      'Du hast nun Zugriff auf unsere Baukoordination-App!',
      '',
      'So meldest du dich an:',
      '1. Link öffnen: {link}',
      '2. E-Mail: {email}',
      '3. Passwort: {passwort}',
      '',
      'Dein Handy bietet beim ersten Mal an, die Anmeldung zu speichern – sag ja, dann musst du das Passwort nie wieder suchen.',
      '',
      'Dann siehst du die Projekte welche dir zugeordnet sind.',
      'Du kannst dort To-Dos erstellen, diese abhaken, kommentieren sowie Fotos und Dokumente hinzufügen.',
      '',
      'Das Passwort gilt nur für diese App – verwende es bitte nirgends sonst. Brauchst du ein neues, melde dich bei uns.',
      '',
      'Viel Spass beim ausprobieren ;)',
      '',
      'Bitte gib uns Bescheid wenn du Verbesserungsvorschläge hast oder einen Fehler entdeckst.',
    ].join('\n'),
    platzhalter: [
      { name: '{vorname}', erklaerung: 'Vorname der Ansprechperson' },
      { name: '{name}', erklaerung: 'Vollständiger Name' },
      { name: '{firma}', erklaerung: 'Firma des Lieferanten' },
      { name: '{email}', erklaerung: 'Die E-Mail-Adresse – zugleich der Benutzername' },
      {
        name: '{passwort}',
        erklaerung: 'Das von uns vergebene Passwort. Leer, solange keines gesetzt ist.',
      },
      { name: '{link}', erklaerung: 'Adresse der App' },
    ],
  },
  {
    schluessel: 'benachrichtigung',
    name: 'Benachrichtigung bei einem Ereignis',
    beschreibung:
      'Neue Aufgabe, Kommentar zu einer Aufgabe, hochgeladenes Dokument oder ' +
      'Offerte, Änderung am Terminplan.',
    betreff: '{projekt}: {wer} {was}',
    text: ['{wer} {was}', '', 'Projekt: {projekt}', '{link}'].join('\n'),
    platzhalter: [
      { name: '{projekt}', erklaerung: 'Name des Projekts' },
      { name: '{wer}', erklaerung: 'Wer die Sache ausgelöst hat' },
      { name: '{was}', erklaerung: 'Was geschehen ist, z.B. „hat To-Do … erstellt“' },
      { name: '{link}', erklaerung: 'Adresse der App' },
    ],
  },
  {
    schluessel: 'update',
    name: 'Update senden',
    beschreibung:
      'Die Zusammenfassung, die du im Register Aktivität von Hand auslöst.',
    betreff: 'Update {projekt}',
    text: ['Neues aus dem Projekt {projekt}:', '', '{eintraege}', '', '{link}'].join(
      '\n',
    ),
    platzhalter: [
      { name: '{projekt}', erklaerung: 'Name des Projekts' },
      { name: '{ort}', erklaerung: 'Ort des Projekts' },
      { name: '{eintraege}', erklaerung: 'Die Liste der Protokolleinträge' },
      { name: '{link}', erklaerung: 'Adresse der App' },
    ],
  },
  {
    schluessel: 'fristablauf',
    name: 'Erinnerung an eine Frist',
    beschreibung: 'Geht raus, wenn eine Aufgabe fällig wird oder überfällig ist.',
    betreff: '{projekt}: {aufgabe}',
    text: ['{aufgabe}', '', 'Frist: {frist}', 'Projekt: {projekt}', '', '{link}'].join(
      '\n',
    ),
    platzhalter: [
      { name: '{projekt}', erklaerung: 'Name des Projekts' },
      { name: '{aufgabe}', erklaerung: 'Text der Aufgabe' },
      { name: '{frist}', erklaerung: 'Fälligkeitsdatum' },
      { name: '{ueberfaellig}', erklaerung: 'Wie lange schon, z.B. „seit 3 Tagen“' },
      { name: '{link}', erklaerung: 'Adresse der App' },
    ],
  },
];

export function standardVorlage(schluessel: VorlagenSchluessel): Vorlage {
  return STANDARD_VORLAGEN.find((v) => v.schluessel === schluessel)!;
}

/**
 * Setzt die Platzhalter ein. Unbekannte bleiben stehen – siehe oben.
 */
export function einsetzen(text: string, werte: Record<string, string>): string {
  return text.replace(/\{([a-zA-Zäöü]+)\}/g, (ganz, name: string) =>
    name in werte ? werte[name] : ganz,
  );
}

/**
 * Ist dieser gespeicherte Text von vor der Umstellung auf Passwörter?
 *
 * Der Zugangscode ist abgeschafft. Eine Einladung, die vorher angepasst wurde,
 * verspricht darin aber weiterhin einen Code – und weil {code} heute nicht mehr
 * gefüllt wird, steht in der Mail wörtlich "{code}". Genau so ist es passiert.
 *
 * Ein solcher Text ist nicht mehr zu retten: Er nennt einen Weg hinein, den es
 * nicht mehr gibt. Deshalb gilt hier wieder der Standard, der E-Mail und
 * Passwort mitschickt. Die angepasste Fassung bleibt in der Tabelle stehen –
 * wer sie behalten will, bearbeitet sie in der App und nimmt {code} heraus.
 */
function veraltet(schluessel: VorlagenSchluessel, text: string): boolean {
  return schluessel === 'einladung' && text.includes('{code}');
}

/**
 * Der gültige Text: die angepasste Fassung, sonst der Standard.
 *
 * Schlägt die Abfrage fehl – etwa weil Migration 0025 fehlt –, wird das nicht
 * zum Fehler gemacht. Eine Mail mit Standardtext ist besser als keine Mail.
 */
export async function ladeVorlage(
  schluessel: VorlagenSchluessel,
): Promise<{ betreff: string; text: string }> {
  const standard = standardVorlage(schluessel);

  try {
    const { data, error } = await serviceClient()
      .from('mail_templates')
      .select('betreff, text')
      .eq('schluessel', schluessel)
      .maybeSingle();

    if (error || !data) return { betreff: standard.betreff, text: standard.text };

    const zeile = data as { betreff: string | null; text: string | null };
    const text = zeile.text?.trim();

    return {
      betreff: zeile.betreff?.trim() || standard.betreff,
      text: text && !veraltet(schluessel, text) ? text : standard.text,
    };
  } catch {
    return { betreff: standard.betreff, text: standard.text };
  }
}
