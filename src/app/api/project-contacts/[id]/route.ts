import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import type { ProjektKontakt } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const SPALTEN = 'id, rolle, name, firma, telefon, email, notiz, sortierung';

/** Ändern. Die Projektprüfung übernimmt die Datenbank über die RLS-Regel. */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

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
