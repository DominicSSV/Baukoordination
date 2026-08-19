import { ApiError, handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { buildDigest, mailEnabled, projectRecipients, sendDigest } from '@/lib/email';
import type { ActivityEntry, Project } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Fasst die letzten 15 Aktivitäten zusammen und schickt sie an alle Beteiligten. */
export const POST = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { data: project } = await ctx.db
    .from('projects')
    .select('id, name, ort, created_at')
    .eq('id', id)
    .maybeSingle();
  if (!project) throw new ApiError('Projekt nicht gefunden.', 404);

  const { data: entries, error } = await ctx.db
    .from('activity')
    .select('id, project_id, actor_name, text, icon, created_at')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) throw new ApiError(`Aktivität: ${error.message}`, 500);

  const list = (entries ?? []) as ActivityEntry[];
  const digest = await buildDigest(project as Project, list);
  const recipients = await projectRecipients(id);

  const fallback = {
    sent: false,
    email: recipients.join(', '),
    subject: digest.subject,
    body: digest.body,
  };

  if (!recipients.length) {
    return ok({
      ...fallback,
      reason:
        'Kein Lieferant mit hinterlegter E-Mail-Adresse hat Zugriff auf dieses Projekt.',
    });
  }

  if (!mailEnabled()) {
    return ok({
      ...fallback,
      reason:
        'Automatischer Mailversand ist nicht konfiguriert (RESEND_API_KEY fehlt). Text zum Kopieren steht bereit.',
    });
  }

  try {
    const count = await sendDigest(project as Project, list);
    return ok({ ...fallback, sent: true, recipientCount: count });
  } catch (e) {
    return ok({
      ...fallback,
      reason: e instanceof Error ? e.message : 'Mailversand fehlgeschlagen.',
    });
  }
});
