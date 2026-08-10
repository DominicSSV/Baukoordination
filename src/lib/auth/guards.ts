import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { forbidden, unauthorized } from '@/lib/api';
import {
  getSessionWithDb,
  type AdminSession,
  type Session,
} from '@/lib/auth/session';
import { serviceClient } from '@/lib/supabase/service';

export type Ctx = {
  session: Session;
  db: SupabaseClient;
  rlsEnforced: boolean;
};

export type AdminCtx = Ctx & { session: AdminSession };

/** Irgendjemand muss angemeldet sein – Admin oder Lieferant. */
export async function requireSession(): Promise<Ctx> {
  const ctx = await getSessionWithDb();
  if (!ctx) throw unauthorized();
  return ctx;
}

/** Nur der Bauherrenvertreter. */
export async function requireAdmin(): Promise<AdminCtx> {
  const ctx = await requireSession();
  if (ctx.session.kind !== 'admin') {
    throw forbidden('Diese Aktion ist dem Bauherrenvertreter vorbehalten.');
  }
  return ctx as AdminCtx;
}

/**
 * Prüft die Projektfreigabe in der Anwendung – zusätzlich zu den RLS-Policies.
 * Die Spezifikation verlangt beides: sichtbare Sperre und serverseitige Sperre.
 */
export async function requireProjectAccess(
  ctx: Ctx,
  projectId: string,
): Promise<void> {
  if (ctx.session.kind === 'admin') return;

  const { data, error } = await serviceClient()
    .from('project_access')
    .select('project_id')
    .eq('project_id', projectId)
    .eq('supplier_id', ctx.session.supplierId)
    .maybeSingle();

  if (error) throw forbidden('Zugriff konnte nicht geprüft werden.');
  if (!data) throw forbidden('Du hast keinen Zugriff auf dieses Projekt.');
}

/** Projekt-ID zu einem To-Do, inkl. Zugriffsprüfung. */
export async function projectIdOfTodo(ctx: Ctx, todoId: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from('todos')
    .select('project_id')
    .eq('id', todoId)
    .maybeSingle();

  if (error || !data) throw forbidden('To-Do nicht gefunden.');
  await requireProjectAccess(ctx, data.project_id);
  return data.project_id;
}
