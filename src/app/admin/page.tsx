import { redirect } from 'next/navigation';
import AdminLogin from '@/components/AdminLogin';
import SetupNotice from '@/components/SetupNotice';
import SignOutButton from '@/components/SignOutButton';
import { getSession } from '@/lib/auth/session';
import { missingCoreEnv } from '@/lib/env';
import { adminAuthClient } from '@/lib/supabase/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Unauffälliger Weg für den Bauherrenvertreter – bewusst ein eigener Pfad statt
 * eines Geheim-Codes auf dem Lieferanten-Bildschirm.
 */
export default async function AdminPage() {
  const missing = missingCoreEnv();
  if (missing.length) return <SetupNotice missing={missing} />;

  const session = await getSession();
  if (session?.kind === 'admin') redirect('/app');

  // Angemeldet, aber (noch) nicht als Admin freigeschaltet: eigener Hinweis statt
  // einer Endlosschleife zwischen Login und Startseite.
  const auth = await adminAuthClient();
  const {
    data: { user },
  } = await auth.auth.getUser();

  if (user && session?.kind !== 'supplier') {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="stripe-bar" />
          <div className="auth-body">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="auth-logo" src="/logo.png" alt="Swiss Solar Ventures AG" />
            <h1>Konto noch nicht freigeschaltet</h1>
            <p>
              Du bist als <strong>{user.email}</strong> angemeldet, dieses Konto ist aber
              noch nicht als Bauherrenvertreter hinterlegt. Ein bestehender Admin kann dich
              freischalten – oder du fügst dich einmalig selbst über den Supabase
              SQL-Editor hinzu:
            </p>
            <pre
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: 12,
                fontSize: 11.5,
                overflowX: 'auto',
                lineHeight: 1.5,
              }}
            >
              {`insert into public.admins (user_id, name, email)\nvalues ('${user.id}', 'Dein Name', '${user.email}')\non conflict (user_id) do nothing;`}
            </pre>
            <SignOutButton />
          </div>
        </div>
      </div>
    );
  }

  return <AdminLogin />;
}
