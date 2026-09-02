import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { buildInvite, mailEnabled, sendInvite } from '@/lib/email';
import type { Supplier } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Verschickt die Einladung per Resend. Der fertige Text kommt in jedem Fall zurück –
 * so bleibt der Kopieren-/mailto-Weg als Rückfalloption erhalten, falls kein
 * Mailversand konfiguriert ist oder der Versand scheitert.
 */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ projectId?: string }>(request);
  const projectId = requireString(body.projectId, 'Projekt', 64);

  // Das vergebene Passwort gehört in die Einladung – sonst weiss der Empfänger
  // zwar, wo die App steht, aber nicht, wie er hineinkommt. Ohne Migration 0031
  // gibt es die Spalte nicht; dann geht die Einladung ohne Passwort raus und
  // sagt das im Text auch.
  const mitPasswort = await ctx.db
    .from('suppliers')
    .select('id, name, firma, gewerk, kontakt, email, start_passwort')
    .eq('id', id)
    .maybeSingle();

  const { data: supplier } = mitPasswort.error
    ? await ctx.db
        .from('suppliers')
        .select('id, name, firma, gewerk, kontakt, email')
        .eq('id', id)
        .maybeSingle()
    : mitPasswort;

  if (!supplier) throw new ApiError('Lieferant nicht gefunden.', 404);

  // Ohne Passwort ist die Einladung wertlos: Sie nennt die Adresse der App und
  // die eigene E-Mail, aber nichts, womit man hineinkommt. Lieber hier
  // abbrechen als eine Mail verschicken, auf die ein Anruf folgt.
  //
  // Fehlt die Spalte (Migration 0031), lässt sich das nicht beurteilen – dann
  // geht die Einladung raus wie bisher.
  if (!mitPasswort.error && !(supplier as { start_passwort?: string | null }).start_passwort) {
    throw new ApiError(
      `Für ${supplier.name?.trim() || supplier.firma?.trim() || 'diesen Lieferanten'} `
        + 'ist noch kein Passwort vergeben. Setze es zuerst im Register „Kontakte“ – '
        + 'die Einladung schickt es dann gleich mit.',
      400,
    );
  }

  const { data: project } = await ctx.db
    .from('projects')
    .select('id, name, ort, created_at')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) throw new ApiError('Projekt nicht gefunden.', 404);

  // Das Projekt wird weiterhin geladen, damit die Freigabe geprüft ist – im Text
  // selbst kommt es nach der neuen Fassung nicht mehr vor.
  const invite = await buildInvite(supplier as Supplier);

  if (!mailEnabled()) {
    return ok({
      sent: false,
      reason:
        'Automatischer Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt). Text zum Kopieren steht bereit.',
      email: supplier.email ?? '',
      subject: invite.subject,
      body: invite.body,
      mailtoUrl: invite.mailtoUrl,
    });
  }

  try {
    await sendInvite(supplier as Supplier);
  } catch (error) {
    return ok({
      sent: false,
      reason: error instanceof Error ? error.message : 'Mailversand fehlgeschlagen.',
      email: supplier.email ?? '',
      subject: invite.subject,
      body: invite.body,
      mailtoUrl: invite.mailtoUrl,
    });
  }

  return ok({
    sent: true,
    email: supplier.email ?? '',
    subject: invite.subject,
    body: invite.body,
    mailtoUrl: invite.mailtoUrl,
  });
});
