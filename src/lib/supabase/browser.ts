'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Supabase-Client im Browser. Wird an zwei Stellen gebraucht:
 * dem Admin-Login (Supabase Auth) und dem direkten Datei-Upload per Signed URL.
 * Er verwendet ausschliesslich den öffentlichen anon-Key.
 */
export function browserClient(): SupabaseClient {
  if (!cached) {
    cached = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return cached;
}
