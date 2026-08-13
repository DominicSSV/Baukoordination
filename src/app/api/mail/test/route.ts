import { ApiError, forbidden, handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { appBaseUrl, mailFrom, mailReplyTo } from '@/lib/env';
import { mailEnabled, sendTestMail } from '@/lib/email';

export const dynamic = 'force-dynamic';

/**
 * Testmail an die eigene Adresse. Der Mailversand scheitert sonst lautlos im
 * Hintergrund einer Aktion – hier kommt der Fehler direkt zurück, mitsamt der
 * Absenderadresse, an der es meistens liegt.
 */
export const POST = handler(async () => {
  const ctx = await requireAdmin();

  if (!ctx.session.email) {
    throw forbidden('Für dein Konto ist keine E-Mail-Adresse hinterlegt.');
  }

  if (!mailEnabled()) {
    throw new ApiError(
      'Mailversand ist nicht eingerichtet: In Vercel fehlt die Umgebungsvariable ' +
        'RESEND_API_KEY. Nach dem Eintragen das Projekt neu bereitstellen.',
    );
  }

  await sendTestMail(ctx.session.email, ctx.session.name);

  return ok({
    ok: true,
    an: ctx.session.email,
    absender: mailFrom(),
    antwortAn: mailReplyTo(),
    app: appBaseUrl(),
  });
});
