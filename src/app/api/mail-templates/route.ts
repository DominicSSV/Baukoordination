import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import {
  STANDARD_VORLAGEN,
  standardVorlage,
  vorlageVeraltet,
  type VorlagenSchluessel,
} from '@/lib/mailVorlagen';

export const dynamic = 'force-dynamic';

const SCHLUESSEL = STANDARD_VORLAGEN.map((v) => v.schluessel);

function pruefeSchluessel(wert: unknown): VorlagenSchluessel {
  const s = typeof wert === 'string' ? wert.trim() : '';
  const treffer = SCHLUESSEL.find((k) => k === s);
  if (!treffer) throw new ApiError('Unbekannte Vorlage.');
  return treffer;
}

/**
 * Die Texte der verschickten Mails.
 *
 * Nur für die Swiss Solar Ventures AG: Hier steht, was in unserem Namen
 * hinausgeht. Geliefert wird zu jeder Vorlage der Standard und – falls
 * vorhanden – die angepasste Fassung, damit sich beides vergleichen lässt.
 */
export const GET = handler(async () => {
  const ctx = await requireAdmin();

  const gespeichert = await ctx.db
    .from('mail_templates')
    .select('schluessel, betreff, text, updated_at, updated_by');

  const eigene = new Map(
    gespeichert.error
      ? []
      : ((gespeichert.data ?? []) as Array<{
          schluessel: string;
          betreff: string;
          text: string;
          updated_at: string;
          updated_by: string | null;
        }>).map((z) => [z.schluessel, z]),
  );

  const vorlagen = STANDARD_VORLAGEN.map((v) => {
    const eigen = eigene.get(v.schluessel);

    // Ein angepasster Text, der noch den abgeschafften Zugangscode nennt, wird
    // beim Versenden übergangen (siehe vorlageVeraltet). Dann muss hier auch
    // der Standard stehen: Diese Ansicht soll zeigen, was der Empfänger
    // tatsächlich bekommt – ein Text, der nie hinausgeht, gehört nicht in die
    // Vorschau.
    const veraltet = vorlageVeraltet(v.schluessel, eigen?.text);
    const gilt = eigen && !veraltet ? eigen : null;

    return {
      ...v,
      betreff: gilt?.betreff ?? v.betreff,
      text: gilt?.text ?? v.text,
      standardBetreff: v.betreff,
      standardText: v.text,
      angepasst: Boolean(gilt),
      /** true = es liegt eine angepasste Fassung vor, die nicht mehr verwendbar ist. */
      veraltet,
      /** Der übergangene Text – damit sich nachlesen lässt, was dort stand. */
      veralteterText: veraltet ? (eigen?.text ?? null) : null,
      geaendertAm: gilt?.updated_at ?? null,
      geaendertVon: gilt?.updated_by ?? null,
    };
  });

  return ok({ vorlagen, ohneTabelle: Boolean(gespeichert.error) });
});

/** Einen Text ändern. */
export const PATCH = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{
    schluessel?: string;
    betreff?: string;
    text?: string;
  }>(request);

  const schluessel = pruefeSchluessel(body.schluessel);
  const betreff = requireString(body.betreff, 'Betreff', 200);
  const text = requireString(body.text, 'Text', 8000);

  const { error } = await ctx.db.from('mail_templates').upsert({
    schluessel,
    betreff,
    text,
    updated_at: new Date().toISOString(),
    updated_by: ctx.session.name,
  });

  if (error) {
    throw new ApiError(
      'Die Texte lassen sich erst nach der Datenbank-Aktualisierung 0025 ' +
        `ändern: ${error.message}`,
      400,
    );
  }

  return ok({ ok: true });
});

/** Zurück zum Standardtext – der Eintrag wird schlicht entfernt. */
export const DELETE = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ schluessel?: string }>(request);
  const schluessel = pruefeSchluessel(body.schluessel);

  const { error } = await ctx.db
    .from('mail_templates')
    .delete()
    .eq('schluessel', schluessel);

  if (error) throw new ApiError(`Zurücksetzen fehlgeschlagen: ${error.message}`, 500);

  const standard = standardVorlage(schluessel);
  return ok({ betreff: standard.betreff, text: standard.text });
});
