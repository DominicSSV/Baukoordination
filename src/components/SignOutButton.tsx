'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

export default function SignOutButton({
  label = 'Abmelden',
  className = 'btn btn-ghost',
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await browserClient().auth.signOut();
        router.replace('/admin');
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
