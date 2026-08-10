/**
 * Zentraler Zugriff auf die Umgebungsvariablen.
 *
 * Bewusst als Funktionen und nicht als Modul-Konstanten: so bricht der Build nicht,
 * wenn beim Kompilieren noch keine Zugangsdaten hinterlegt sind – der Fehler kommt
 * erst zur Laufzeit, dafür mit klarem Text.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Umgebungsvariable ${name} fehlt. Bitte in .env.local (lokal) bzw. in den ` +
        `Vercel-Projekteinstellungen (produktiv) hinterlegen – siehe README.md.`,
    );
  }
  return value;
}

/** Welche Pflichtvariablen fehlen? Leer = alles da. */
export function missingCoreEnv(): string[] {
  return [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ].filter((key) => !process.env[key]);
}

export function supabaseUrl(): string {
  return required('NEXT_PUBLIC_SUPABASE_URL');
}

export function supabaseAnonKey(): string {
  return required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export function supabaseServiceRoleKey(): string {
  return required('SUPABASE_SERVICE_ROLE_KEY');
}

/**
 * Legacy-JWT-Secret des Supabase-Projekts (Dashboard > Project Settings > API Keys >
 * JWT Keys). Damit signiert der Server die kurzlebigen Lieferanten-Tokens, sodass die
 * RLS-Policies auch für Lieferanten greifen.
 *
 * Fehlt das Secret, läuft die App weiter – dann aber ohne RLS-Durchsetzung für
 * Lieferanten, weil serverseitig auf den service_role-Key zurückgefallen wird. Die
 * Berechtigungsprüfungen in den API-Routen greifen in beiden Fällen.
 */
export function supabaseJwtSecret(): string | null {
  return process.env.SUPABASE_JWT_SECRET || null;
}

export function resendApiKey(): string | null {
  return process.env.RESEND_API_KEY || null;
}

export function mailFrom(): string {
  return process.env.MAIL_FROM || 'Baukoordination <onboarding@resend.dev>';
}

/** Basis-URL der App, für Links in E-Mails. */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export const STORAGE_BUCKET = 'project-files';
export const SUPPLIER_COOKIE = 'bk_supplier_session';
/** Wie lange ein Lieferant angemeldet bleibt, ohne den Code erneut einzugeben. */
export const SUPPLIER_SESSION_DAYS = 30;
