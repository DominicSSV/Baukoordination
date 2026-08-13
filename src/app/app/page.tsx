import { redirect } from 'next/navigation';
import Workspace from '@/components/workspace/Workspace';
import SetupNotice from '@/components/SetupNotice';
import { getSessionWithDb } from '@/lib/auth/session';
import { listProjects } from '@/lib/projects';
import { missingCoreEnv } from '@/lib/env';
import { isRlsEnforcedForSuppliers } from '@/lib/supabase/supplier';
import { mailEnabled } from '@/lib/email';
import { signAvatar } from '@/lib/avatars';
import type { SessionInfo } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Baut aus den Parametern eines geteilten Links wieder einen Pfad – aber nur
 * aus den beiden, die wir kennen. Alles andere wird verworfen, damit über
 * diesen Umweg niemand eine fremde Adresse einschleusen kann.
 */
function zielAusParametern(
  params: Record<string, string | string[] | undefined>,
): string | null {
  const einzeln = (wert: string | string[] | undefined) =>
    typeof wert === 'string' ? wert : null;

  const projekt = einzeln(params.p);
  const register = einzeln(params.t);

  if (!projekt || !/^[0-9a-f-]{36}$/i.test(projekt)) return null;
  const teil = register && /^[a-z]{4,12}$/.test(register) ? `&t=${register}` : '';
  return `/app?p=${projekt}${teil}`;
}

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const missing = missingCoreEnv();
  if (missing.length) return <SetupNotice missing={missing} />;

  const ctx = await getSessionWithDb();

  // Wer über einen geteilten Link kommt und noch nicht angemeldet ist, soll
  // nach der Anmeldung genau dort landen – und nicht auf der Startseite.
  if (!ctx) {
    const ziel = zielAusParametern(await searchParams);
    redirect(ziel ? `/?next=${encodeURIComponent(ziel)}` : '/');
  }

  const avatarUrl = await signAvatar(ctx.session.avatarPath);

  const info: SessionInfo =
    ctx.session.kind === 'admin'
      ? {
          kind: 'admin',
          userId: ctx.session.userId,
          name: ctx.session.name,
          firma: ctx.session.firma,
          funktion: ctx.session.funktion,
          email: ctx.session.email,
          rlsEnforced: isRlsEnforcedForSuppliers(),
          mailEnabled: mailEnabled(),
          avatarUrl,
        }
      : {
          kind: 'supplier',
          supplierId: ctx.session.supplierId,
          name: ctx.session.name,
          firma: ctx.session.firma,
          avatarUrl,
        };

  const projects = await listProjects(ctx);

  return <Workspace session={info} initialProjects={projects} />;
}
