import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { SignJWT } from 'jose';
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
    mailversand: {
      schluessel: process.env.RESEND_API_KEY
        ? {
            vorhanden: true,
            beginnt_mit_re: process.env.RESEND_API_KEY.trim().startsWith('re_'),
            laenge: process.env.RESEND_API_KEY.trim().length,
          }
        : { vorhanden: false },
      absender: process.env.MAIL_FROM || 'Baukoordination <onboarding@resend.dev> (Standard)',
      antwort_an: process.env.MAIL_REPLY_TO || '(keine)',
      an_lieferanten: process.env.MAIL_AN_LIEFERANTEN === 'true',
      meldet_bei: 'neue Aufgabe, Dokument/Offerte hochgeladen, Terminplan geändert',
      interne_domain: process.env.MAIL_INTERNE_DOMAIN || 'swiss-sv.ch',
      hinweis: process.env.RESEND_API_KEY
        ? undefined
        : 'RESEND_API_KEY fehlt – es wird nichts verschickt. In Vercel eintragen ' +
          'und danach neu bereitstellen.',
    },
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

      // Welche Ausbaustufe der Datenbank steht? Das entscheidet darüber, ob sich
      // Aufgaben einzelnen Personen zuweisen lassen und ob Lieferanten eigene
      // Aufgaben anlegen dürfen.
      const profil = await db.from('admins').select('funktion').limit(1);
      const seed = await db.from('admin_seed').select('email').limit(1);
      const view = await db.from('admin_public').select('user_id').limit(1);

      const plan = await db.from('schedule_tasks').select('id').limit(1);
      const planZeitraum = await db.from('projects').select('schedule_start').limit(1);
      report.migration_0006 = {
        terminplan: !plan.error && !planZeitraum.error,
        hinweis:
          plan.error || planZeitraum.error
            ? 'Migration 0006 fehlt. Der Terminplan lässt sich ohne sie nicht speichern.'
            : undefined,
      };

      const offerten = await db.from('files').select('offer_folder').limit(1);
      const protokollVertraulich = await db
        .from('activity')
        .select('supplier_id')
        .limit(1);
      report.migration_0012 = {
        offerten_ordner: !offerten.error,
        protokoll_vertraulich: !protokollVertraulich.error,
        hinweis:
          offerten.error || protokollVertraulich.error
            ? 'Migration 0012 fehlt. Ohne sie lassen sich keine Offerten einreichen.'
            : undefined,
      };

      const firmenregel = await db.rpc('darf_offerte_sehen', { p_uploader: null });
      report.migration_0013 = {
        offerten_je_firma: !firmenregel.error,
        hinweis: firmenregel.error
          ? 'Migration 0013 fehlt. Ohne sie sieht jede Ansprechperson nur die eigenen ' +
            'Offerten, nicht die ihrer Firma – und der Ordner "Auftragsbestätigung" wird abgewiesen.'
          : undefined,
      };

      const mehrfach = await db.from('todos').select('assignees').limit(1);
      report.migration_0014 = {
        mehrere_zustaendige: !mehrfach.error,
        hinweis: mehrfach.error
          ? 'Migration 0014 fehlt. Aufgaben lassen sich nur einer Person zuweisen, ' +
            'und Lieferanten sehen weiterhin alle Aufgaben des Projekts.'
          : undefined,
      };

      const vertraulich = await db.from('todos').select('vertraulich').limit(1);
      const protokollFirmen = await db.from('activity').select('supplier_ids').limit(1);
      report.migration_0015 = {
        vertrauliche_aufgaben: !vertraulich.error,
        protokoll_je_firma: !protokollFirmen.error,
        hinweis:
          vertraulich.error || protokollFirmen.error
            ? 'Migration 0015 fehlt. Aufgaben lassen sich nicht als vertraulich kennzeichnen.'
            : undefined,
      };

      const notizen = await db.from('file_comments').select('id').limit(1);
      report.migration_0016 = {
        offerten_kommentare: !notizen.error,
        hinweis: notizen.error
          ? 'Migration 0016 fehlt. Offerten lassen sich nicht kommentieren.'
          : undefined,
      };

      const korb = await db.from('todos').select('deleted_at').limit(1);
      const betrag = await db.from('files').select('offer_amount').limit(1);
      report.migration_0017 = {
        papierkorb: !korb.error,
        offerten_betraege: !betrag.error,
        hinweis:
          korb.error || betrag.error
            ? 'Migration 0017 fehlt. Gelöschtes ist sofort endgültig weg und ' +
              'Offerten haben weder Betrag noch Stand.'
            : undefined,
      };

      const bilder = await db.from('admins').select('avatar_path').limit(1);
      report.migration_0005 = {
        profilbilder: !bilder.error,
        hinweis: bilder.error ? 'Migration 0005 fehlt. Keine Profilbilder.' : undefined,
      };

      const frist = await db.from('todos').select('due_date').limit(1);
      report.migration_0004 = {
        fristen: !frist.error,
        hinweis: frist.error
          ? 'Migration 0004 fehlt. Ohne sie lassen sich keine Aufgaben anlegen, ' +
            'weil die Spalte für die Frist noch nicht existiert.'
          : undefined,
      };

      report.migration_0002 = {
        profilspalten: !profil.error,
        namensliste: !seed.error,
        view_admin_public: !view.error,
        vollstaendig: !profil.error && !seed.error && !view.error,
        hinweis:
          !profil.error && !seed.error && !view.error
            ? undefined
            : 'Migration 0002 ist noch nicht (vollständig) eingespielt. ' +
              'Ohne sie dürfen Lieferanten keine eigenen Aufgaben anlegen.',
      };
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

  // Wichtigster Test für die Lieferanten-Anmeldung: Akzeptiert die Datenbank ein vom
  // Server selbst signiertes Token? Nur dann setzt Postgres die RLS-Policies für
  // Lieferanten durch. Signiert wird ein Wegwerf-Token mit einer erfundenen ID – es
  // darf nichts finden, es muss nur angenommen werden.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET?.trim();

  if (!jwtSecret) {
    report.lieferanten_token = {
      ok: false,
      fehler: 'SUPABASE_JWT_SECRET ist nicht gesetzt',
      folge:
        'Lieferanten-Zugriffe werden nur von der App geprüft, nicht zusätzlich von der Datenbank.',
    };
  } else if (!url || !anonKey) {
    report.lieferanten_token = { ok: false, fehler: 'URL oder anon-Schlüssel fehlt' };
  } else {
    try {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ role: 'authenticated', supplier_id: randomUUID() })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(randomUUID())
        .setAudience('authenticated')
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .sign(new TextEncoder().encode(jwtSecret));

      const response = await fetch(`${url}/rest/v1/projects?select=id&limit=1`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      report.lieferanten_token = response.ok
        ? { ok: true }
        : {
            ok: false,
            status: response.status,
            antwort: (await response.text()).slice(0, 300),
            hinweis:
              'Das JWT Secret passt nicht zu diesem Projekt. Zu finden im Dashboard ' +
              'unter Project Settings > JWT Keys > "JWT Secret" (Legacy, HS256).',
          };
    } catch (e) {
      report.lieferanten_token = {
        ok: false,
        fehler: e instanceof Error ? e.message : 'unbekannter Fehler',
      };
    }
  }

  return NextResponse.json(report, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
