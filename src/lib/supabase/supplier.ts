import 'server-only';
import { SignJWT } from 'jose';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseJwtSecret, supabaseUrl } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

/** Gültigkeit des Datenbank-Tokens. Kurz, weil es pro Anfrage neu ausgestellt wird. */
const DB_TOKEN_TTL_SECONDS = 600;

/**
 * Stellt ein kurzlebiges, HS256-signiertes JWT mit dem Claim `supplier_id` aus.
 * Postgres liest den Claim in `current_supplier_id()` und wendet darauf die
 * RLS-Policies an – dieselbe Sperre gilt damit serverseitig, nicht nur in der
 * Oberfläche.
 */
async function mintSupplierToken(supplierId: string): Promise<string | null> {
  const secret = supabaseJwtSecret();
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    role: 'authenticated',
    supplier_id: supplierId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(supplierId)
    .setAudience('authenticated')
    .setIssuedAt(now)
    .setExpirationTime(now + DB_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret));
}

export type SupplierDb = {
  client: SupabaseClient;
  /** false = SUPABASE_JWT_SECRET fehlt, es greifen nur die Prüfungen der API-Routen. */
  rlsEnforced: boolean;
};

/**
 * Datenbank-Client für einen angemeldeten Lieferanten.
 *
 * Regelfall: anon-Key plus signiertes Lieferanten-JWT, damit Postgres die
 * RLS-Policies durchsetzt. Ist kein JWT-Secret hinterlegt, fällt der Client auf
 * service_role zurück; die Zugriffsprüfungen in den Routen bleiben davon unberührt,
 * aber die serverseitige Zweitsicherung durch RLS entfällt (README beachten).
 */
export async function supplierDb(supplierId: string): Promise<SupplierDb> {
  const token = await mintSupplierToken(supplierId);
  if (!token) {
    return { client: serviceClient(), rlsEnforced: false };
  }

  const client = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  return { client, rlsEnforced: true };
}

export function isRlsEnforcedForSuppliers(): boolean {
  return Boolean(supabaseJwtSecret());
}
