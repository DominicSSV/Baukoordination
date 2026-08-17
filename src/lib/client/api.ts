'use client';

/**
 * Schmaler Fetch-Wrapper. Wirft bei jedem Fehler eine Exception mit lesbarer
 * Meldung – damit im UI nichts stumm scheitern kann (UX-Prinzip der Spezifikation).
 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(
      'Keine Verbindung zum Server. Bitte Internetverbindung prüfen und erneut versuchen.',
    );
  }

  const raw = await response.text();
  let payload: unknown = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Serverfehler (${response.status}).`;
    throw new Error(message);
  }

  return payload as T;
}

export const post = <T,>(url: string, body?: unknown) =>
  api<T>(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined });

export const patch = <T,>(url: string, body: unknown) =>
  api<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

/**
 * Löschen. Ein Rumpf ist erlaubt – manche Routen brauchen zusätzlich zur Adresse
 * noch die Angabe, was genau entfernt werden soll (z.B. welcher Ordner).
 */
export const del = <T,>(url: string, body?: unknown) =>
  api<T>(url, {
    method: 'DELETE',
    body: body ? JSON.stringify(body) : undefined,
  });
