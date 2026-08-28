/**
 * Der kleine Ton beim Abhaken.
 *
 * Erzeugt statt abgespielt: Zwei kurze Rechteckschwingungen, erst ein hohes H,
 * dann ein noch höheres E, das ausklingt. Genau das ist der Aufbau der
 * bekannten Münze aus alten Spielkonsolen – ein Intervall, keine Aufnahme.
 *
 * Bewusst kein fremdes Klangbeispiel: Die Originalaufnahme gehört Nintendo,
 * und eine hochgeladene Datei wäre eine Urheberrechtsfrage für ein Geräusch
 * von einer Drittelsekunde. Dazu kommt: So gibt es keine Datei zu laden, der
 * Ton kommt auch bei schlechtem Empfang auf der Baustelle sofort, und die App
 * wird kein Byte grösser.
 */

/** Im Browser gemerkt, damit die Wahl das Gerät nicht verlässt. */
const SCHALTER = 'bk-ton';

export function tonAn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Standard ist an – wer es nicht mag, schaltet es im Profil aus.
    return window.localStorage.getItem(SCHALTER) !== 'aus';
  } catch {
    return true;
  }
}

export function setzeTon(an: boolean): void {
  try {
    window.localStorage.setItem(SCHALTER, an ? 'an' : 'aus');
  } catch {
    // Ein Browser, der nichts speichern darf, ist kein Grund für einen Fehler –
    // dann gilt eben bei jedem Start wieder der Standard.
  }
}

/**
 * Ein Tonpaar bauen und abspielen.
 *
 * Die Tonhöhen sind H5 und E6 – eine reine Quarte. Der Wechsel nach oben ist
 * das, was das Ohr als "gewonnen" hört; ginge es abwärts, klänge dasselbe
 * Geräusch nach Fehler.
 */
export function spieleMuenze(): void {
  if (!tonAn()) return;

  try {
    type MitAlt = typeof window & { webkitAudioContext?: typeof AudioContext };
    const Klasse =
      window.AudioContext ?? (window as MitAlt).webkitAudioContext ?? null;
    if (!Klasse) return;

    const ctx = new Klasse();
    const jetzt = ctx.currentTime;

    const oszillator = ctx.createOscillator();
    const lautstaerke = ctx.createGain();

    // Rechteck statt Sinus: Der etwas raue Klang gehört zum Vorbild dazu.
    oszillator.type = 'square';
    oszillator.frequency.setValueAtTime(988, jetzt); // H5, kurz angerissen
    oszillator.frequency.setValueAtTime(1319, jetzt + 0.08); // E6, klingt aus

    // Leise beginnen und weich ausklingen. Ohne das knackt es am Anfang und
    // am Ende hörbar, weil die Schwingung hart abbricht.
    lautstaerke.gain.setValueAtTime(0.0001, jetzt);
    lautstaerke.gain.exponentialRampToValueAtTime(0.16, jetzt + 0.01);
    lautstaerke.gain.setValueAtTime(0.16, jetzt + 0.08);
    lautstaerke.gain.exponentialRampToValueAtTime(0.0001, jetzt + 0.42);

    oszillator.connect(lautstaerke);
    lautstaerke.connect(ctx.destination);

    oszillator.start(jetzt);
    oszillator.stop(jetzt + 0.45);

    // Aufräumen, sonst bleibt je Abhaken ein Tonkanal offen. Browser erlauben
    // davon nur eine begrenzte Zahl; irgendwann käme gar kein Ton mehr.
    oszillator.onended = () => void ctx.close().catch(() => {});
  } catch {
    // Kein Ton ist kein Fehler. Auf einem stummgeschalteten Gerät oder ohne
    // vorherige Berührung verweigert der Browser das Abspielen – das Abhaken
    // selbst darf davon nichts merken.
  }
}
