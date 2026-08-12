import { ApiError, handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Protokolleintrag löschen. Ausschliesslich für die Swiss Solar Ventures AG –
 * ein Lieferant darf das Protokoll weder bereinigen noch Spuren daraus entfernen.
 * Dieselbe Sperre steht als Policy activity_admin_delete in der Datenbank.
 */
export const DELETE = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();

  const { error } = await ctx.db.from('activity').delete().eq('id', id);
  if (error) throw new ApiError(`Löschen fehlgeschlagen: ${error.message}`, 500);

  return ok({ ok: true });
});
