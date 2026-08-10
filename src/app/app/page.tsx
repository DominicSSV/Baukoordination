import { redirect } from 'next/navigation';
import Workspace from '@/components/workspace/Workspace';
import SetupNotice from '@/components/SetupNotice';
import { getSessionWithDb } from '@/lib/auth/session';
import { listProjects } from '@/lib/projects';
import { missingCoreEnv } from '@/lib/env';
import { isRlsEnforcedForSuppliers } from '@/lib/supabase/supplier';
import { mailEnabled } from '@/lib/email';
import type { SessionInfo } from '@/types';

export const dynamic = 'force-dynamic';

export default async function AppPage() {
  const missing = missingCoreEnv();
  if (missing.length) return <SetupNotice missing={missing} />;

  const ctx = await getSessionWithDb();
  if (!ctx) redirect('/');

  const info: SessionInfo =
    ctx.session.kind === 'admin'
      ? {
          kind: 'admin',
          name: ctx.session.name,
          email: ctx.session.email,
          rlsEnforced: isRlsEnforcedForSuppliers(),
          mailEnabled: mailEnabled(),
        }
      : {
          kind: 'supplier',
          supplierId: ctx.session.supplierId,
          name: ctx.session.name,
          firma: ctx.session.firma,
        };

  const projects = await listProjects(ctx);

  return <Workspace session={info} initialProjects={projects} />;
}
