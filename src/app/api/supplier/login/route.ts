import { cookies } from 'next/headers';
import { ApiError, handler, ok, readJson } from '@/lib/api';
import { normalizeCode } from '@/lib/codes';
import { createSupplierSession, supplierLabel } from '@/lib/auth/session';
import { serviceClient } from '@/lib/supabase/service';
import { SUPPLIER_COOKIE, SUPPLIER_SESSION_DAYS } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Anmeldung per Zugangscode. Die Prüfung läuft bewusst über service_role, weil zu
 * diesem Zeitpunkt noch keine Identität feststeht – gefunden wird ausschliesslich
 * über den exakten Code, es wird nichts anderes aus der Tabelle zurückgegeben.
 */
export const POST = handler(async (request: Request) => {
  const { code } = await readJson<{ code?: string }>(request);
  const normalized = normalizeCode(String(code ?? ''));

  if (!normalized) throw new ApiError('Bitte gib deinen Zugangscode ein.');

  const { data: supplier, error } = await serviceClient()
    .from('suppliers')
    .select('id, name, firma')
    .eq('access_code', normalized)
    .maybeSingle();

  if (error) throw new ApiError(`Anmeldung fehlgeschlagen: ${error.message}`, 500);
  if (!supplier) {
    throw new ApiError(
      'Code ungültig. Bitte bei der Swiss Solar Ventures AG nachfragen.',
      401,
    );
  }

  const userAgent = request.headers.get('user-agent');
  const token = await createSupplierSession(supplier.id, userAgent);

  const store = await cookies();
  store.set(SUPPLIER_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SUPPLIER_SESSION_DAYS * 24 * 60 * 60,
  });

  return ok({ name: supplierLabel(supplier) });
});
