import { ApiError, forbidden, handler, ok, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { appBaseUrl, mailFrom, mailReplyTo } from '@/lib/env';
import { mailEnabled, sendTestMail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Testmail an die eigene Adresse. Der Mailversand scheitert sonst lautlos im
 * Hintergrund einer Aktion – hier kommt der Fehler direkt zurück, mitsamt der
 * Absenderadresse, an der es meistens liegt.
 */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{ an?: string }>(request);
  // Solange die Domain nicht freigeschaltet ist, nimmt Resend nur die Adresse
  // des Kontoinhabers an – deshalb muss sich das Ziel wählen lassen.
  const an = body.an?.trim() || ctx.session.email;

  if (!an) {
    throw forbidden('Für dein Konto ist keine E-Mail-Adresse hinterlegt.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(an)) {
    throw new ApiError('Das ist keine gültige E-Mail-Adresse.');
  }

  if (!mailEnabled()) {
    throw new ApiError(
      'Mailversand ist nicht eingerichtet: In Vercel fehlt die Umgebungsvariable ' +
        'RESEND_API_KEY. Nach dem Eintragen das Projekt neu bereitstellen.',
    );
  }

  await sendTestMail(an, ctx.session.name);

  return ok({
    ok: true,
    an,
    absender: mailFrom(),
    antwortAn: mailReplyTo(),
    app: appBaseUrl(),
  });
});
