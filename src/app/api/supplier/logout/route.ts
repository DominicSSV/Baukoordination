import { cookies } from 'next/headers';
import { handler, ok } from '@/lib/api';
import { destroySupplierSession } from '@/lib/auth/session';
import { SUPPLIER_COOKIE } from '@/lib/env';

export const dynamic = 'force-dynamic';

export const POST = handler(async () => {
  const store = await cookies();
  const token = store.get(SUPPLIER_COOKIE)?.value;

  if (token) await destroySupplierSession(token);
  store.delete(SUPPLIER_COOKIE);

  return ok({ ok: true });
});
