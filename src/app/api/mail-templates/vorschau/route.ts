import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { baueVorschau } from '@/lib/email';
import { STANDARD_VORLAGEN, type VorlagenSchluessel } from '@/lib/mailVorlagen';

export const dynamic = 'force-dynamic';

const SCHLUESSEL = STANDARD_VORLAGEN.map((v) => v.schluessel);

/**
 * Wie die Mail beim Empfänger aussieht.
 *
 * Gerechnet wird mit dem Text aus dem Bearbeitungsfeld, nicht mit dem
 * gespeicherten: Man soll sehen, was man gerade tippt, und erst danach
 * entscheiden, ob es so gespeichert wird.
 *
 * Nur für uns – wie die Vorlagen selbst.
 */
export const POST = handler(async (request: Request) => {
  await requireAdmin();

  const body = await readJson<{
    schluessel?: string;
    betreff?: string;
    text?: string;
  }>(request);

  const roh = typeof body.schluessel === 'string' ? body.schluessel.trim() : '';
  const schluessel = SCHLUESSEL.find((k) => k === roh) as VorlagenSchluessel | undefined;
  if (!schluessel) throw new ApiError('Unbekannte Vorlage.');

  const betreff = requireString(body.betreff, 'Betreff', 200);
  const text = requireString(body.text, 'Text', 8000);

  return ok(baueVorschau(schluessel, betreff, text));
});
