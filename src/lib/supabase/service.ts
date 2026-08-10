import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServiceRoleKey, supabaseUrl } from '@/lib/env';

let cached: SupabaseClient | null = null;

/**
 * Client mit service_role-Rechten. Umgeht RLS vollständig und darf deshalb
 * ausschliesslich serverseitig verwendet werden – für Dinge, die es ohne
 * angemeldeten Benutzer geben muss (Code-Prüfung beim Login, Session-Tabelle,
 * Storage-Signaturen) und niemals als Abkürzung um eine Berechtigungsprüfung herum.
 */
export function serviceClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(supabaseUrl(), supabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
