import 'server-only';
import { NextResponse } from 'next/server';

/**
 * Fehler mit einer Meldung, die der Benutzer lesen darf und soll.
 *
 * UX-Prinzip aus der Spezifikation: keine Aktion darf stumm scheitern. Jede Route
 * wirft im Fehlerfall einen ApiError, das Frontend zeigt dessen Text als Toast an.
 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const unauthorized = (msg = 'Bitte zuerst anmelden.') => new ApiError(msg, 401);
export const forbidden = (msg = 'Dafür fehlt dir die Berechtigung.') =>
  new ApiError(msg, 403);
export const notFound = (msg = 'Nicht gefunden.') => new ApiError(msg, 404);

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init);
}

export function fail(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[api]', error);
  const message =
    error instanceof Error ? error.message : 'Unbekannter Fehler auf dem Server.';
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Umschliesst einen Route-Handler, damit kein Fehler ohne Rückmeldung verpufft. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>,
): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (error) {
      return fail(error);
    }
  };
}

/** Wirft, wenn Supabase einen Fehler meldet – sonst schluckt der Aufrufer ihn leicht. */
export function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  context: string,
): T {
  if (result.error) throw new ApiError(`${context}: ${result.error.message}`, 500);
  if (result.data === null) throw notFound(context);
  return result.data;
}

export function assertNoError(
  result: { error: { message: string } | null },
  context: string,
): void {
  if (result.error) throw new ApiError(`${context}: ${result.error.message}`, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError('Ungültige Anfrage (kein gültiges JSON).');
  }
}

export function requireString(value: unknown, field: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(`Feld "${field}" darf nicht leer sein.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ApiError(`Feld "${field}" ist zu lang (max. ${max} Zeichen).`);
  }
  return trimmed;
}

export function optionalString(value: unknown, max = 2000): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}
