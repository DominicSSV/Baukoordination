import 'server-only';
import { ApiError } from '@/lib/api';
import { parseAssignee, INTERNAL } from '@/lib/assignee';
import { serviceClient } from '@/lib/supabase/service';
import type { Session } from '@/lib/auth/session';

/**
 * Prüft, ob der Angemeldete eine Aufgabe an diesen Zuständigen übergeben darf,
 * und gibt den bereinigten Wert für todos.assigned_to zurück.
 *
 * Regeln:
 *   - an die Swiss Solar Ventures AG (allgemein oder eine Person): beide Seiten
 *   - an einen Lieferanten: nur der Bauherrenvertreter, und nur wenn dieser
 *     Lieferant auch Zugriff auf das Projekt hat
 */
/** Klartextname eines Zuständigen, für Protokoll und Benachrichtigung. */
export async function assigneeDisplayName(value: string): Promise<string> {
  const assignee = parseAssignee(value);
  if (assignee.kind === 'internal') return 'Swiss Solar Ventures AG';

  if (assignee.kind === 'admin') {
    const { data } = await serviceClient()
      .from('admins')
      .select('name')
      .eq('user_id', assignee.id)
      .maybeSingle();
    return data?.name?.trim() || 'Swiss Solar Ventures AG';
  }

  const { data } = await serviceClient()
    .from('suppliers')
    .select('name, firma')
    .eq('id', assignee.id)
    .maybeSingle();

  return data?.name?.trim() || data?.firma?.trim() || 'Unbekannt';
}

export async function resolveAssignee(
  session: Session,
  projectId: string,
  raw: unknown,
): Promise<string> {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : INTERNAL;
  const assignee = parseAssignee(value);

  if (assignee.kind === 'internal') return INTERNAL;

  if (assignee.kind === 'admin') {
    const { data } = await serviceClient()
      .from('admins')
      .select('user_id')
      .eq('user_id', assignee.id)
      .maybeSingle();

    if (!data) {
      throw new ApiError('Diese Person ist nicht als Bauherrenvertreter hinterlegt.');
    }
    return `admin:${assignee.id}`;
  }

  if (session.kind === 'supplier') {
    throw new ApiError(
      'Du kannst Aufgaben nur der Swiss Solar Ventures AG zuweisen, nicht einem anderen Lieferanten.',
      403,
    );
  }

  const { data } = await serviceClient()
    .from('project_access')
    .select('supplier_id')
    .eq('project_id', projectId)
    .eq('supplier_id', assignee.id)
    .maybeSingle();

  if (!data) {
    throw new ApiError(
      'Dieser Lieferant hat keinen Zugriff auf das Projekt und kann keine Aufgabe erhalten.',
    );
  }

  return `supplier:${assignee.id}`;
}
