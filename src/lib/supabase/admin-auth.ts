import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/**
 * Supabase-Client für den Admin-Login (echte Supabase-Auth). Liest und schreibt die
 * Auth-Cookies. Alle Abfragen laufen als Rolle `authenticated`, also unter RLS.
 */
export async function adminAuthClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // In Server Components ist das Setzen von Cookies nicht erlaubt.
          // Die Middleware erneuert die Session, deshalb ist das hier unkritisch.
        }
      },
    },
  });
}
