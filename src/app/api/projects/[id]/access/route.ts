import { ApiError, assertNoError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/** Zugriff auf ein Projekt erteilen oder entziehen – ausschliesslich für den Admin. */
export const POST = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireAdmin();

  const body = await readJson<{ supplierId?: string; grant?: boolean }>(request);
  const supplierId = requireString(body.supplierId, 'Lieferant', 64);
  const grant = body.grant !== false;

  if (grant) {
    const result = await ctx.db
      .from('project_access')
      .upsert({ project_id: projectId, supplier_id: supplierId });
    assertNoError(result, 'Zugriff konnte nicht erteilt werden');
  } else {
    const result = await ctx.db
      .from('project_access')
      .delete()
      .eq('project_id', projectId)
      .eq('supplier_id', supplierId);
    assertNoError(result, 'Zugriff konnte nicht entzogen werden');
  }

  // Beim Entzug alle laufenden Sitzungen des Lieferanten beenden, falls er danach
  // auf gar kein Projekt mehr Zugriff hat – sonst bliebe eine leere Sitzung offen.
  if (!grant) {
    const { count } = await serviceClient()
      .from('project_access')
      .select('project_id', { count: 'exact', head: true })
      .eq('supplier_id', supplierId);

    if (!count) {
      await serviceClient()
        .from('supplier_sessions')
        .delete()
        .eq('supplier_id', supplierId);
    }
  }

  // Historie über Rechteänderungen (Punkt 7 der Spezifikation).
  const audit = await ctx.db.from('access_audit').insert({
    project_id: projectId,
    supplier_id: supplierId,
    action: grant ? 'grant' : 'revoke',
    actor: ctx.session.name,
  });
  if (audit.error) {
    // Das Audit-Log darf die eigentliche Aktion nicht verhindern, aber der Fehler
    // wird sichtbar gemeldet statt verschluckt.
    throw new ApiError(
      `Zugriff wurde geändert, aber das Protokoll schlug fehl: ${audit.error.message}`,
      500,
    );
  }

  return ok({ ok: true });
});
