import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';

/**
 * Liest aus einer Offerten-PDF den Betrag exklusive Mehrwertsteuer.
 *
 * Es ist eine Heuristik über den Text der PDF – sie findet die üblichen
 * Schweizer Schreibweisen ("Total exkl. MwSt", "Nettobetrag", …). Findet sie
 * nichts Verlässliches, gibt sie null zurück und der Betrag bleibt zum
 * Selbst-Eintragen offen. Lieber kein Betrag als ein falscher.
 */
export async function betragAusPdf(daten: Uint8Array): Promise<number | null> {
  const pdf = await getDocumentProxy(daten);
  const { text } = await extractText(pdf, { mergePages: true });
  return findeBetragExklMwst(text);
}

/** Zahl im Schweizer oder deutschen Format lesen, z.B. 12'400.50 oder 12.400,50. */
function alsZahl(roh: string): number | null {
  let wert = roh.replace(/[’'\s]/g, '').trim();
  if (!wert) return null;

  const punkt = wert.lastIndexOf('.');
  const komma = wert.lastIndexOf(',');

  if (punkt !== -1 && komma !== -1) {
    // Beide vorhanden: das spätere Zeichen trennt die Rappen.
    if (komma > punkt) wert = wert.replace(/\./g, '').replace(',', '.');
    else wert = wert.replace(/,/g, '');
  } else if (komma !== -1) {
    // Nur Komma: Dezimaltrenner, wenn danach 1–2 Ziffern folgen.
    const danach = wert.length - komma - 1;
    wert = danach <= 2 ? wert.replace(',', '.') : wert.replace(/,/g, '');
  } else if (punkt !== -1) {
    // Nur Punkt: bei genau drei Ziffern danach ist es ein Tausendertrenner.
    const danach = wert.length - punkt - 1;
    if (danach === 3) wert = wert.replace(/\./g, '');
  }

  const zahl = Number(wert);
  if (!Number.isFinite(zahl)) return null;
  // Plausibel für eine Offerte: zwischen 1 Franken und 100 Millionen.
  if (zahl < 1 || zahl > 100_000_000) return null;
  return Math.round(zahl * 100) / 100;
}

/** Ziffernfolge samt Tausender- und Dezimaltrennern. */
const ZAHL = String.raw`((?:\d{1,3}(?:[’'\s.,]\d{3})+|\d+)(?:[.,]\d{1,2})?)`;
/** Was zwischen Stichwort und Zahl stehen darf – z.B. "CHF", ":" oder Punkte. */
const DAZWISCHEN = String.raw`[^0-9\n]{0,40}?`;

/**
 * Muster in absteigender Verlässlichkeit. Gefunden wird jeweils der letzte
 * Treffer im Text: Totale stehen am Schluss, nach Rabatten und Zwischensummen.
 */
const MUSTER: RegExp[] = [
  // "Total exkl. MwSt CHF 12'400.50", "Summe excl. Mehrwertsteuer", "Betrag ohne MWST"
  new RegExp(
    String.raw`(?:total|summe|betrag|preis)${DAZWISCHEN}(?:exkl|excl|ohne|zzgl)\.?${DAZWISCHEN}(?:mwst|mw?st|mehrwertsteuer|vat)\.?${DAZWISCHEN}${ZAHL}`,
    'gi',
  ),
  // "Nettototal", "Nettobetrag", "Total netto", "Nettosumme"
  new RegExp(
    String.raw`(?:netto(?:total|betrag|summe|preis)?|total${DAZWISCHEN}netto)${DAZWISCHEN}${ZAHL}`,
    'gi',
  ),
  // "exkl. MwSt" irgendwo mit Zahl in der Nähe – die schwächste Form.
  new RegExp(
    String.raw`(?:exkl|excl|ohne)\.?\s*(?:mwst|mw?st|mehrwertsteuer|vat)\.?${DAZWISCHEN}${ZAHL}`,
    'gi',
  ),
];

const INKL = new RegExp(
  String.raw`(?:total|summe|betrag)${DAZWISCHEN}(?:inkl|incl)\.?${DAZWISCHEN}(?:mwst|mw?st|mehrwertsteuer|vat)\.?${DAZWISCHEN}${ZAHL}`,
  'gi',
);
const MWST_BETRAG = new RegExp(
  String.raw`(?:mwst|mw?st|mehrwertsteuer|vat)\.?[^0-9\n%]{0,20}(?:\d{1,2}(?:[.,]\d{1,2})?\s*%)?${DAZWISCHEN}${ZAHL}`,
  'gi',
);

function letzterTreffer(muster: RegExp, text: string): number | null {
  let ergebnis: number | null = null;
  for (const treffer of text.matchAll(muster)) {
    const zahl = alsZahl(treffer[1]);
    if (zahl !== null) ergebnis = zahl;
  }
  return ergebnis;
}

export function findeBetragExklMwst(text: string): number | null {
  for (const muster of MUSTER) {
    const zahl = letzterTreffer(muster, text);
    if (zahl !== null) return zahl;
  }

  // Nur ein Total inklusive gefunden: Steuerbetrag abziehen, wenn er dasteht.
  // Den Satz zu raten (8.1 %? 2.6 %?) wäre zu unsicher – dann lieber nichts.
  const inklusive = letzterTreffer(INKL, text);
  if (inklusive !== null) {
    const steuer = letzterTreffer(MWST_BETRAG, text);
    if (steuer !== null && steuer > 0 && steuer < inklusive * 0.15) {
      return Math.round((inklusive - steuer) * 100) / 100;
    }
  }

  return null;
}
