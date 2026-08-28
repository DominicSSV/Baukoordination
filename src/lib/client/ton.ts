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
 * Ein einziger Klangkanal für die ganze Sitzung.
 *
 * Vorher legte jeder Ton einen eigenen an. Das geht ein paar Mal gut und hört
 * dann auf: Browser erlauben nur eine Handvoll gleichzeitig, und auf dem
 * iPhone werden sie nur zögerlich wieder freigegeben. Wer schnell mehrere
 * Aufgaben abhakt, hörte irgendwann gar nichts mehr – ohne Fehlermeldung.
 *
 * Angelegt wird er beim ersten Ton, also innerhalb eines Fingertipps. Das ist
 * Bedingung: Ein Kanal, der ohne Zutun entsteht, bleibt stummgeschaltet.
 */
let kanal: AudioContext | null = null;

function holeKanal(): AudioContext | null {
  type MitAlt = typeof window & { webkitAudioContext?: typeof AudioContext };
  const Klasse = window.AudioContext ?? (window as MitAlt).webkitAudioContext ?? null;
  if (!Klasse) return null;

  if (!kanal || kanal.state === 'closed') kanal = new Klasse();

  // Nach längerem Nichtstun legt der Browser den Kanal schlafen; ohne das
  // Aufwecken bliebe es still.
  if (kanal.state === 'suspended') void kanal.resume().catch(() => {});

  return kanal;
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
    const ctx = holeKanal();
    if (!ctx) return;
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

    // Der Schwinger räumt sich nach dem Stoppen selbst weg; der gemeinsame
    // Kanal bleibt bewusst offen und wird beim nächsten Ton wiederverwendet.
    oszillator.onended = () => oszillator.disconnect();
  } catch {
    // Kein Ton ist kein Fehler. Auf einem stummgeschalteten Gerät oder ohne
    // vorherige Berührung verweigert der Browser das Abspielen – das Abhaken
    // selbst darf davon nichts merken.
  }
}

/**
 * Das Gegenstück: die traurige Posaune, wenn ein Haken wieder wegkommt.
 *
 * Vier Töne abwärts, jeder rutscht in der Tonhöhe nach unten, der letzte hängt
 * länger und wackelt. Das Wackeln ist der eigentliche Witz – ohne es klingt
 * dieselbe Tonfolge nur nach Fehlermeldung, mit ihm nach Schulterzucken.
 *
 * Sägezahn statt Rechteck: Er hat die Obertöne eines Blechblasinstruments. Ein
 * Tiefpassfilter nimmt ihm die Schärfe, sonst quäkt es statt zu jammern.
 */
export function spieleSchade(): void {
  if (!tonAn()) return;

  try {
    const ctx = holeKanal();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    const oszillator = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const lautstaerke = ctx.createGain();

    oszillator.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    // Vier Stufen abwärts, je ein Halbton, und innerhalb jeder Stufe rutscht
    // die Tonhöhe noch etwas weiter – das ergibt das "wuah".
    const stufen = [
      { start: 262, ende: 247, ab: 0, bis: 0.16 }, // C4 → H3
      { start: 247, ende: 233, ab: 0.18, bis: 0.34 }, // H3 → B3
      { start: 233, ende: 220, ab: 0.36, bis: 0.52 }, // B3 → A3
      { start: 220, ende: 196, ab: 0.54, bis: 1.05 }, // A3 → G3, der lange
    ];

    for (const s of stufen) {
      oszillator.frequency.setValueAtTime(s.start, t0 + s.ab);
      oszillator.frequency.linearRampToValueAtTime(s.ende, t0 + s.bis);
    }

    // Jede Stufe kurz absetzen, sonst wird daraus ein einziges langes Rutschen.
    lautstaerke.gain.setValueAtTime(0.0001, t0);
    for (const s of stufen) {
      lautstaerke.gain.setValueAtTime(0.0001, t0 + s.ab);
      lautstaerke.gain.exponentialRampToValueAtTime(0.13, t0 + s.ab + 0.02);
      lautstaerke.gain.setValueAtTime(0.13, t0 + s.bis - 0.03);
      lautstaerke.gain.exponentialRampToValueAtTime(0.0001, t0 + s.bis);
    }

    // Das Wackeln auf dem letzten Ton: ein langsamer Zusatzschwinger, der die
    // Tonhöhe leicht auf und ab schiebt.
    const wackeln = ctx.createOscillator();
    const wackelTiefe = ctx.createGain();
    wackeln.frequency.value = 6;
    wackelTiefe.gain.setValueAtTime(0, t0);
    wackelTiefe.gain.setValueAtTime(0, t0 + 0.6);
    wackelTiefe.gain.linearRampToValueAtTime(7, t0 + 0.75);
    wackeln.connect(wackelTiefe);
    wackelTiefe.connect(oszillator.frequency);

    oszillator.connect(filter);
    filter.connect(lautstaerke);
    lautstaerke.connect(ctx.destination);

    oszillator.start(t0);
    wackeln.start(t0);
    oszillator.stop(t0 + 1.1);
    wackeln.stop(t0 + 1.1);

    oszillator.onended = () => {
      oszillator.disconnect();
      wackeln.disconnect();
    };
  } catch {
    // Siehe oben: Kein Ton ist kein Fehler.
  }
}
