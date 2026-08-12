import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Diagnose der Einrichtung. Muss ohne Anmeldung erreichbar sein, weil sie genau dann
 * gebraucht wird, wenn die Anmeldung noch nicht funktioniert.
 *
 * Gibt bewusst keine Schlüssel aus – nur ob sie vorhanden sind, wie lang sie sind und
 * ob sie plausibel aussehen. Die Projekt-URL ist ohnehin öffentlich, sie steckt auch
 * im Browser-Bundle.
 */
function describeKey(raw: string | undefined) {
  const value = raw?.trim() ?? '';
  if (!value) return { vorhanden: false as const };

  return {
    vorhanden: true as const,
    laenge: value.length,
    // Ein Supabase-Schlüssel im JWT-Format hat genau zwei Punkte.
    sieht_aus_wie: value.split('.').length === 3 ? 'JWT (eyJ…)' : 'einfacher Text',
    beginnt_mit: `${value.slice(0, 6)}…`,
    hat_leerzeichen_am_rand: raw !== value,
  };
}

export async function GET() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const url = rawUrl ? normalizeSupabaseUrl(rawUrl) : '';

  const urlBefund: Record<string, unknown> = {
    wert: url || '(nicht gesetzt)',
    unveraendert_uebernommen: rawUrl === url,
  };

  if (url) {
    const erwartet = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url);
    urlBefund.form_ok = erwartet;
    if (!erwartet) {
      urlBefund.hinweis =
        'Erwartet wird genau "https://<projekt-id>.supabase.co" – ohne Pfad, ohne ' +
        'Schrägstrich am Ende. Zu finden im Supabase-Dashboard unter ' +
        'Project Settings > Data API > Project URL.';
    }
  }

  const report: Record<string, unknown> = {
    projekt_url: urlBefund,
    anon_key: describeKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    service_role_key: describeKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
    jwt_secret: describeKey(process.env.SUPABASE_JWT_SECRET),
    mailversand: process.env.RESEND_API_KEY ? 'konfiguriert' : 'nicht konfiguriert',
  };

  // Echter Verbindungstest: liest die Anzahl freigeschalteter Admins. Schlägt das fehl,
  // stimmt entweder die URL, der Schlüssel oder das Datenbank-Skript nicht.
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && serviceKey) {
    try {
      const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { count, error } = await db
        .from('admins')
        .select('user_id', { count: 'exact', head: true });

      report.datenbank = error
        ? { ok: false, fehler: error.message }
        : { ok: true, freigeschaltete_admins: count ?? 0 };
    } catch (e) {
      report.datenbank = {
        ok: false,
        fehler: e instanceof Error ? e.message : 'unbekannter Fehler',
      };
    }
  } else {
    report.datenbank = { ok: false, fehler: 'URL oder service_role-Schlüssel fehlt' };
  }

  // Derselbe Weg wie beim Admin-Login: erreicht die App den Auth-Dienst überhaupt?
  if (url && anonKey) {
    try {
      const response = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: anonKey },
        cache: 'no-store',
      });
      report.anmeldedienst = response.ok
        ? { ok: true }
        : {
            ok: false,
            status: response.status,
            antwort: (await response.text()).slice(0, 200),
          };
    } catch (e) {
      report.anmeldedienst = {
        ok: false,
        fehler: e instanceof Error ? e.message : 'unbekannter Fehler',
      };
    }
  } else {
    report.anmeldedienst = { ok: false, fehler: 'URL oder anon-Schlüssel fehlt' };
  }

  return NextResponse.json(report, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
