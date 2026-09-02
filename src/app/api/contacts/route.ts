import { ApiError, handler, ok, optionalString, readJson, requireString } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { signAvatars } from '@/lib/avatars';
import { serviceClient } from '@/lib/supabase/service';
import type { Kontakt } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Die ganze Projektmannschaft an einer Stelle – wir und alle Lieferanten,
 * samt Zugangscodes und der Angabe, wer auf welches Projekt zugreifen darf.
 *
 * Nur für die Swiss Solar Ventures AG: Hier stehen die Zugangscodes und die
 * Kontaktdaten sämtlicher Firmen beieinander. Ein Lieferant hat auf dieser
 * Ansicht nichts verloren.
 */
export const GET = handler(async () => {
  await requireAdmin();
  const db = serviceClient();

  const [adminRes, lieferantenRes, projekteRes, zugriffRes] = await Promise.all([
    db.from('admins').select('user_id, name, firma, funktion, email, kontakt, avatar_path'),
    db
      .from('suppliers')
      .select(
        'id, name, firma, gewerk, kontakt, email, access_code, avatar_path, mail_an, passwort_gesetzt_am',
      )
      .order('firma', { ascending: true }),
    db.from('projects').select('id, name'),
    db.from('project_access').select('supplier_id, project_id'),
  ]);

  // Ohne Migration 0024 gibt es die Zuteilung noch nicht – dann ist sie leer
  // und die Benachrichtigungen gehen wie bisher an alle.
  const internRes = await db.from('project_admins').select('user_id, project_id');

  // Ohne Migration 0023 gibt es die Telefonnummer bei uns noch nicht.
  const adminsRoh = adminRes.error
    ? await db.from('admins').select('user_id, name, firma, funktion, email, avatar_path')
    : adminRes;

  if (adminsRoh.error) {
    throw new ApiError(`Kontakte konnten nicht geladen werden: ${adminsRoh.error.message}`, 500);
  }
  // Ohne Migration 0027 gibt es die Mail-Freigabe noch nicht.
  const lieferantenRoh = lieferantenRes.error
    ? await db
        .from('suppliers')
        .select('id, name, firma, gewerk, kontakt, email, access_code, avatar_path')
        .order('firma', { ascending: true })
    : lieferantenRes;

  if (lieferantenRoh.error) {
    throw new ApiError(
      `Lieferanten konnten nicht geladen werden: ${lieferantenRoh.error.message}`,
      500,
    );
  }

  type AdminZeile = {
    user_id: string;
    name: string;
    firma: string;
    funktion: string | null;
    email: string | null;
    kontakt?: string | null;
    avatar_path: string | null;
  };
  type LieferantZeile = {
    id: string;
    name: string | null;
    firma: string | null;
    gewerk: string | null;
    kontakt: string | null;
    email: string | null;
    access_code: string | null;
    avatar_path: string | null;
    mail_an?: boolean | null;
    passwort_gesetzt_am?: string | null;
  };

  const adminZeilen = (adminsRoh.data ?? []) as AdminZeile[];
  const lieferantZeilen = (lieferantenRoh.data ?? []) as LieferantZeile[];

  const bilder = await signAvatars([
    ...adminZeilen.map((a) => a.avatar_path),
    ...lieferantZeilen.map((l) => l.avatar_path),
  ]);

  const projektNamen = new Map(
    ((projekteRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [
      p.id,
      p.name,
    ]),
  );

  // Wer darf auf welches Projekt? Für die Zeile des Lieferanten aufbereitet.
  const zugriffe = new Map<string, string[]>();
  for (const z of (zugriffRes.data ?? []) as Array<{
    supplier_id: string;
    project_id: string;
  }>) {
    const liste = zugriffe.get(z.supplier_id) ?? [];
    if (projektNamen.has(z.project_id)) liste.push(z.project_id);
    zugriffe.set(z.supplier_id, liste);
  }

  const intern = new Map<string, string[]>();
  if (!internRes.error) {
    for (const z of (internRes.data ?? []) as Array<{
      user_id: string;
      project_id: string;
    }>) {
      const liste = intern.get(z.user_id) ?? [];
      if (projektNamen.has(z.project_id)) liste.push(z.project_id);
      intern.set(z.user_id, liste);
    }
  }

  const kontakte: Kontakt[] = [
    ...adminZeilen.map((a) => ({
      art: 'admin' as const,
      id: a.user_id,
      name: a.name,
      firma: a.firma,
      rolle: a.funktion,
      kontakt: a.kontakt ?? null,
      email: a.email,
      code: null,
      avatarUrl: a.avatar_path ? (bilder.get(a.avatar_path) ?? null) : null,
      projekte: intern.get(a.user_id) ?? [],
      // Bei uns entscheidet die Firmen-Domain, nicht eine Freigabe je Person.
      mailAn: true,
      // Bei uns läuft die Anmeldung über den Anmeldedienst, nicht über ein
      // Passwort in dieser Tabelle.
      hatPasswort: true,
    })),
    ...lieferantZeilen.map((l) => ({
      art: 'lieferant' as const,
      id: l.id,
      name: l.name ?? '',
      firma: l.firma ?? '',
      rolle: l.gewerk,
      kontakt: l.kontakt,
      email: l.email,
      code: l.access_code,
      avatarUrl: l.avatar_path ? (bilder.get(l.avatar_path) ?? null) : null,
      projekte: zugriffe.get(l.id) ?? [],
      mailAn: l.mail_an === true,
      hatPasswort: Boolean(l.passwort_gesetzt_am),
    })),
  ];

  const projekte = [...projektNamen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return ok({
    kontakte,
    projekte,
    ohneTelefonspalte: Boolean(adminRes.error),
    ohneMailFreigabe: Boolean(lieferantenRes.error),
    ohneZuteilung: Boolean(internRes.error),
  });
});

/**
 * Angaben zu einer Person der Swiss Solar Ventures AG ändern.
 *
 * Die Lieferanten laufen weiter über /api/suppliers/<id>; dort hängen
 * Zugangscode und Projektfreigaben mit dran.
 *
 * Die E-Mail bleibt aussen vor: An ihr hängt die Anmeldung, sie hier zu
 * ändern würde jemanden aus der App aussperren.
 */
export const PATCH = handler(async (request: Request) => {
  const ctx = await requireAdmin();

  const body = await readJson<{
    userId?: string;
    name?: string;
    firma?: string;
    funktion?: string | null;
    kontakt?: string | null;
  }>(request);

  const userId = requireString(body.userId, 'userId', 64);
  const name = requireString(body.name, 'Name', 200);

  const felder: Record<string, unknown> = {
    name,
    firma: optionalString(body.firma, 200) ?? 'Swiss Solar Ventures AG',
    funktion: optionalString(body.funktion, 120),
  };

  const mitTelefon = await ctx.db
    .from('admins')
    .update({ ...felder, kontakt: optionalString(body.kontakt, 120) })
    .eq('user_id', userId);

  // Ohne Migration 0023 fehlt die Spalte – dann eben ohne Telefonnummer.
  if (mitTelefon.error) {
    const { error } = await ctx.db.from('admins').update(felder).eq('user_id', userId);
    if (error) throw new ApiError(`Speichern fehlgeschlagen: ${error.message}`, 500);
    return ok({ ok: true, ohneTelefonspalte: true });
  }

  return ok({ ok: true });
});
