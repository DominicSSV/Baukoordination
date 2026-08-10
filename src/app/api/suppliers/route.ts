import { ApiError, handler, ok, optionalString, readJson } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { genCode } from '@/lib/codes';
import type { Supplier } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireAdmin();

  const { data, error } = await ctx.db
    .from('suppliers')
    .select('id, name, firma, gewerk, kontakt, email, access_code, created_at')
    .order('created_at', { ascending: true });

  if (error) throw new ApiError(`Lieferanten: ${error.message}`, 500);
  return ok({ suppliers: (data ?? []) as Supplier[] });
});

/** Neuen Lieferanten anlegen und optional direkt für ein Projekt freigeben. */
export const POST = handler(async (request: Request) => {
  const ctx = await requireAdmin();
  const body = await readJson<{
    name?: string;
    firma?: string;
    gewerk?: string;
    kontakt?: string;
    email?: string;
    projectId?: string;
  }>(request);

  const name = optionalString(body.name, 200);
  const firma = optionalString(body.firma, 200);
  if (!name && !firma) {
    throw new ApiError('Bitte mindestens Firma oder Ansprechperson angeben.');
  }

  const payload = {
    name,
    firma,
    gewerk: optionalString(body.gewerk, 120),
    kontakt: optionalString(body.kontakt, 120),
    email: optionalString(body.email, 200),
  };

  // Der Zugangscode muss eindeutig sein; bei einer Kollision einfach neu würfeln.
  let supplier: Supplier | null = null;
  let lastError = '';

  for (let attempt = 0; attempt < 6 && !supplier; attempt += 1) {
    const result = await ctx.db
      .from('suppliers')
      .insert({ ...payload, access_code: genCode() })
      .select('id, name, firma, gewerk, kontakt, email, access_code, created_at')
      .single();

    if (!result.error) {
      supplier = result.data as Supplier;
      break;
    }
    lastError = result.error.message;
    if (!lastError.includes('suppliers_access_code_key')) break;
  }

  if (!supplier) {
    throw new ApiError(`Lieferant konnte nicht angelegt werden: ${lastError}`, 500);
  }

  const projectId = optionalString(body.projectId, 64);
  if (projectId) {
    const access = await ctx.db
      .from('project_access')
      .upsert({ project_id: projectId, supplier_id: supplier.id });

    if (access.error) {
      throw new ApiError(
        `Lieferant angelegt, aber die Freigabe schlug fehl: ${access.error.message}`,
        500,
      );
    }

    await ctx.db.from('access_audit').insert({
      project_id: projectId,
      supplier_id: supplier.id,
      action: 'grant',
      actor: ctx.session.name,
      detail: 'beim Anlegen',
    });
  }

  return ok({ supplier }, { status: 201 });
});
