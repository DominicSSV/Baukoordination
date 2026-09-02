import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import type { ProjektKontakt } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN = 'id, rolle, name, firma, telefon, email, notiz, sortierung';

/**
 * Ändern darf jeder mit Zugriff auf das Projekt – auch die Lieferanten.
 *
 * Zu welchem Projekt der Eintrag gehört, steht nicht in der Adresse, deshalb
 * wird er zuerst nachgeschlagen. Ohne das könnte jemand mit Zugriff auf ein
 * Projekt Einträge eines fremden ändern; die RLS-Regel fängt das zwar auch ab,
 * aber die Anwendung soll es gar nicht erst versuchen.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireSession();

  const { data: eintrag } = await ctx.db
    .from('project_contacts')
    .select('project_id')
    .eq('id', id)
    .maybeSingle();

  if (!eintrag) throw new ApiError('Eintrag nicht gefunden.', 404);
  await requireProjectAccess(ctx, (eintrag as { project_id: string }).project_id);

  const body = await readJson<{
    rolle?: string;
    name?: string;
    firma?: string;
    telefon?: string;
    email?: string;
    notiz?: string;
  }>(request);

  const { data, error } = await ctx.db
    .from('project_contacts')
    .update({
      rolle: requireString(body.rolle, 'Funktion', 120),
      name: optionalString(body.name, 200),
      firma: optionalString(body.firma, 200),
      telefon: optionalString(body.telefon, 60),
      email: optionalString(body.email, 200),
      notiz: optionalString(body.notiz, 500),
    })
    .eq('id', id)
    .select(SPALTEN)
    .single();

  if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);
  return ok({ kontakt: data as ProjektKontakt });
});

/**
 * Löschen – hier endgültig, ohne Papierkorb.
 *
 * Eine Adresszeile ist schnell wieder erfasst; ein Papierkorb dafür wäre mehr
 * Verwaltung als Nutzen. Anders als bei Aufgaben und Dateien hängt daran auch
 * nichts, was man später noch bräuchte.
 */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { error } = await ctx.db.from('project_contacts').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
