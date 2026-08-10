import { NextResponse } from 'next/server';
import { adminAuthClient } from '@/lib/supabase/admin-auth';

export const dynamic = 'force-dynamic';

/** Einlösepunkt für den Magic Link aus dem Admin-Login. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/app';

  if (!code) {
    return NextResponse.redirect(new URL('/admin?error=missing_code', url.origin));
  }

  const supabase = await adminAuthClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL(`/admin?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
