import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { missingCoreEnv } from '@/lib/env';
import SetupNotice from '@/components/SetupNotice';
import SupplierLogin from '@/components/SupplierLogin';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const missing = missingCoreEnv();
  if (missing.length) return <SetupNotice missing={missing} />;

  const session = await getSession();
  if (session) redirect('/app');

  return <SupplierLogin />;
}
