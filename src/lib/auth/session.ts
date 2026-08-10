import 'server-only';
import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPPLIER_COOKIE, SUPPLIER_SESSION_DAYS } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';
import { adminAuthClient } from '@/lib/supabase/admin-auth';
import { supplierDb } from '@/lib/supabase/supplier';

export type AdminSession = {
  kind: 'admin';
  userId: string;
  name: string;
  email: string | null;
};

export type SupplierSession = {
  kind: 'supplier';
  supplierId: string;
  name: string;
  firma: string | null;
};

export type Session = AdminSession | SupplierSession;

/** Anzeigename eines Lieferanten – Ansprechperson, sonst Firma. */
export function supplierLabel(s: {
  name?: string | null;
  firma?: string | null;
}): string {
  return (s.name?.trim() || s.firma?.trim() || 'Unbekannt') as string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Lieferanten-Session
// ---------------------------------------------------------------------------

/** Legt eine neue Lieferanten-Session an und gibt das Cookie-Token zurück. */
export async function createSupplierSession(
  supplierId: string,
  userAgent: string | null,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(
    Date.now() + SUPPLIER_SESSION_DAYS * 24 * 60 * 60 * 1000,
  );

  const { error } = await serviceClient().from('supplier_sessions').insert({
    token_hash: hashToken(token),
    supplier_id: supplierId,
    expires_at: expiresAt.toISOString(),
    user_agent: userAgent,
  });
  if (error) throw new Error(`Session konnte nicht angelegt werden: ${error.message}`);

  return token;
}

export async function destroySupplierSession(token: string): Promise<void> {
  await serviceClient()
    .from('supplier_sessions')
    .delete()
    .eq('token_hash', hashToken(token));
}

async function readSupplierSession(): Promise<SupplierSession | null> {
  const token = (await cookies()).get(SUPPLIER_COOKIE)?.value;
  if (!token) return null;

  const db = serviceClient();
  const { data: session } = await db
    .from('supplier_sessions')
    .select('supplier_id, expires_at')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!session) return null;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await destroySupplierSession(token);
    return null;
  }

  const { data: supplier } = await db
    .from('suppliers')
    .select('id, name, firma')
    .eq('id', session.supplier_id)
    .maybeSingle();

  if (!supplier) return null;

  return {
    kind: 'supplier',
    supplierId: supplier.id,
    name: supplierLabel(supplier),
    firma: supplier.firma ?? null,
  };
}

// ---------------------------------------------------------------------------
// Admin-Session
// ---------------------------------------------------------------------------

async function readAdminSession(): Promise<AdminSession | null> {
  let auth;
  try {
    auth = await adminAuthClient();
  } catch {
    return null;
  }

  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return null;

  // Ein Auth-Account allein reicht nicht – der Benutzer muss als Admin freigeschaltet
  // sein. Die Prüfung läuft über service_role, damit sie nicht an RLS scheitert.
  const { data: admin } = await serviceClient()
    .from('admins')
    .select('user_id, name, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!admin) return null;

  return {
    kind: 'admin',
    userId: user.id,
    name: admin.name?.trim() || user.email?.split('@')[0] || 'Bauherrenvertreter',
    email: admin.email ?? user.email ?? null,
  };
}

/**
 * Ermittelt, wer gerade angemeldet ist.
 *
 * Die Lieferanten-Session hat Vorrang: Wer sich mit einem Zugangscode anmeldet, sieht
 * die App auch dann aus Lieferantensicht, wenn im selben Browser noch ein
 * Admin-Login liegt – abmelden stellt die Adminsicht wieder her.
 */
export async function getSession(): Promise<Session | null> {
  return (await readSupplierSession()) ?? (await readAdminSession());
}

/**
 * Liefert zusätzlich den passenden Datenbank-Client:
 * Admin -> Auth-Client (RLS als `authenticated`), Lieferant -> signiertes JWT.
 */
export async function getSessionWithDb(): Promise<{
  session: Session;
  db: SupabaseClient;
  rlsEnforced: boolean;
} | null> {
  const session = await getSession();
  if (!session) return null;

  if (session.kind === 'admin') {
    return { session, db: await adminAuthClient(), rlsEnforced: true };
  }

  const { client, rlsEnforced } = await supplierDb(session.supplierId);
  return { session, db: client, rlsEnforced };
}

/** Anzeigename für Protokoll-Einträge. */
export function actorName(session: Session): string {
  return session.name;
}
