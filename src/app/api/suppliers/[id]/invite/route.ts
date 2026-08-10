import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { buildInvite, mailEnabled, sendInvite } from '@/lib/email';
import type { Project, Supplier } from '@/types';

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

  const { data: supplier } = await ctx.db
    .from('suppliers')
    .select('id, name, firma, gewerk, kontakt, email, access_code')
    .eq('id', id)
    .maybeSingle();
  if (!supplier) throw new ApiError('Lieferant nicht gefunden.', 404);

  const { data: project } = await ctx.db
    .from('projects')
    .select('id, name, ort, created_at')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) throw new ApiError('Projekt nicht gefunden.', 404);

  const invite = buildInvite(supplier as Supplier, project as Project);

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
    await sendInvite(supplier as Supplier, project as Project);
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
