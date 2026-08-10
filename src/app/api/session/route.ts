import { handler, ok } from '@/lib/api';
import { getSession } from '@/lib/auth/session';
import { isRlsEnforcedForSuppliers } from '@/lib/supabase/supplier';
import { mailEnabled } from '@/lib/email';
import type { SessionInfo } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ session: null });

  const info: SessionInfo =
    session.kind === 'admin'
      ? {
          kind: 'admin',
          name: session.name,
          email: session.email,
          rlsEnforced: isRlsEnforcedForSuppliers(),
          mailEnabled: mailEnabled(),
        }
      : {
          kind: 'supplier',
          supplierId: session.supplierId,
          name: session.name,
          firma: session.firma,
        };

  return ok({ session: info });
});
