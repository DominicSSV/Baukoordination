import { handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { AVATAR_BUCKET } from '@/lib/avatars';
import { STORAGE_BUCKET } from '@/lib/env';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Ohne eigene Angabe: 1 GB, das ist der Umfang des kostenlosen Supabase-Plans. */
function grenzeInBytes(): number {
  const roh = Number(process.env.STORAGE_LIMIT_GB);
  const gb = Number.isFinite(roh) && roh > 0 ? roh : 1;
  return Math.round(gb * 1024 * 1024 * 1024);
}

type Eintrag = { pfad: string; bytes: number };

/**
 * Alles auflisten, was tatsächlich im Speicher liegt – Ordner für Ordner.
 *
 * Der Weg über die Datenbank allein wäre zu optimistisch: Vorschaubilder haben
 * dort keine Zeile, und was beim Löschen im Speicher hängen blieb, taucht gar
 * nicht auf. Gefragt ist aber, wie voll es wirklich ist.
 */
async function inhalt(bucket: string, prefix = '', tiefe = 0): Promise<Eintrag[]> {
  if (tiefe > 3) return []; // So tief verschachtelt legen wir nichts ab.

  const speicher = serviceClient().storage.from(bucket);
  const gefunden: Eintrag[] = [];
  const unterordner: string[] = [];

  // Supabase gibt höchstens ein Bündel auf einmal zurück – bis zum Ende blättern.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await speicher.list(prefix, { limit: 1000, offset });
    if (error || !data?.length) break;

    for (const eintrag of data) {
      const pfad = prefix ? `${prefix}/${eintrag.name}` : eintrag.name;
      // Ein Ordner hat weder Kennung noch Angaben zur Datei.
      if (!eintrag.id) unterordner.push(pfad);
      else gefunden.push({ pfad, bytes: Number(eintrag.metadata?.size ?? 0) });
    }

    if (data.length < 1000) break;
  }

  for (const ordner of unterordner) {
    gefunden.push(...(await inhalt(bucket, ordner, tiefe + 1)));
  }

  return gefunden;
}

/**
 * Wie viel Speicher tatsächlich belegt ist – gesamt und je Projekt.
 *
 * Nur für uns: Ein Lieferant erführe daraus, wie viel die anderen Firmen
 * hochgeladen haben.
 */
export const GET = handler(async () => {
  await requireAdmin();
  const db = serviceClient();

  const { data: projekte } = await db.from('projects').select('id, name');
  const namen = new Map((projekte ?? []).map((p) => [p.id, p.name]));

  const dateien = await inhalt(STORAGE_BUCKET);
  const profilbilder = await inhalt(AVATAR_BUCKET);

  // Der erste Teil des Pfades ist die Projektkennung – so sind die Uploads
  // abgelegt. Alles andere landet unter "Sonstiges".
  const proProjekt = new Map<string, { bytes: number; anzahl: number }>();
  let gesamt = 0;
  let vorschau = 0;

  for (const eintrag of dateien) {
    gesamt += eintrag.bytes;
    if (eintrag.pfad.includes('/thumbs/')) vorschau += eintrag.bytes;

    const projekt = eintrag.pfad.split('/')[0];
    const bisher = proProjekt.get(projekt) ?? { bytes: 0, anzahl: 0 };
    proProjekt.set(projekt, {
      bytes: bisher.bytes + eintrag.bytes,
      anzahl: bisher.anzahl + 1,
    });
  }

  const avatarBytes = profilbilder.reduce((summe, e) => summe + e.bytes, 0);
  gesamt += avatarBytes;

  // Was im Papierkorb liegt, lässt sich nur über die Datenbank zuordnen.
  let papierkorb = 0;
  const geloescht = await db
    .from('files')
    .select('size_bytes')
    .not('deleted_at', 'is', null);
  if (!geloescht.error) {
    papierkorb = (geloescht.data ?? []).reduce(
      (summe, z) => summe + (z.size_bytes ?? 0),
      0,
    );
  }

  const liste = [...proProjekt.entries()]
    .map(([id, wert]) => ({
      id,
      name: namen.get(id) ?? 'Nicht mehr zugeordnet',
      bytes: wert.bytes,
      anzahl: wert.anzahl,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return ok({
    gesamt,
    papierkorb,
    vorschau,
    avatare: avatarBytes,
    anzahl: dateien.length + profilbilder.length,
    grenze: grenzeInBytes(),
    projekte: liste,
  });
});
