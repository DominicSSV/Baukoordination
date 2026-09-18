import { handler, ok, readJson } from '@/lib/api';
import { requireAdmin, requireProjectAccess } from '@/lib/auth/guards';
import { pauseSeit, pauseSetzen } from '@/lib/stille';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Benachrichtigungen für dieses Projekt abstellen und wieder einschalten.
 *
 * Nur für uns. Ein Lieferant könnte sonst seine eigenen Änderungen still
 * einspielen, und genau das soll die Baustellenkoordination verhindern.
 *
 * Die Einstellung gilt je Person: Stellt einer sie zum Aufräumen ab, bleiben
 * seine Handgriffe still – die der anderen melden sich weiterhin.
 */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, id);

  const seit = await pauseSeit(ctx.session.userId, id);
  return ok({ aus: seit !== null, seit });
});

export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireAdmin();
  await requireProjectAccess(ctx, id);

  const body = await readJson<{ aus?: boolean }>(request);
  const aus = body.aus === true;

  const ergebnis = await pauseSetzen(ctx.session.userId, id, aus);

  if (!ergebnis.ok) {
    return ok({
      aus: (await pauseSeit(ctx.session.userId, id)) !== null,
      warning:
        `Nicht gespeichert: ${ergebnis.fehler}. `
        + 'Fehlt Migration 0038? Ohne sie lässt sich nichts abstellen.',
    });
  }

  // Beim Einschalten wird nichts nachgeholt – siehe lib/stille.ts.
  return ok({ aus, seit: aus ? new Date().toISOString() : null });
});
