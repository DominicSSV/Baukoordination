import { handler, ok } from '@/lib/api';
import { getSession } from '@/lib/auth/session';
import { isRlsEnforcedForSuppliers } from '@/lib/supabase/supplier';
import { mailEnabled, mailTestbetrieb } from '@/lib/email';
import { signAvatar } from '@/lib/avatars';
import type { SessionInfo } from '@/types';

export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ session: null });

  const avatarUrl = await signAvatar(session.avatarPath);

  const info: SessionInfo =
    session.kind === 'admin'
      ? {
          kind: 'admin',
          userId: session.userId,
          name: session.name,
          firma: session.firma,
          funktion: session.funktion,
          email: session.email,
          rlsEnforced: isRlsEnforcedForSuppliers(),
          mailEnabled: mailEnabled(),
          mailTestbetrieb: mailTestbetrieb(),
          avatarUrl,
        }
      : {
          kind: 'supplier',
          supplierId: session.supplierId,
          name: session.name,
          firma: session.firma,
          avatarUrl,
        };

  return ok({ session: info });
});
