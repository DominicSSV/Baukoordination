import { handler, ok } from '@/lib/api';
import { requireAdmin } from '@/lib/auth/guards';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

/** Ohne eigene Angabe: 1 GB, das ist der Umfang des kostenlosen Supabase-Plans. */
function grenzeInBytes(): number {
  const roh = Number(process.env.STORAGE_LIMIT_GB);
  const gb = Number.isFinite(roh) && roh > 0 ? roh : 1;
  return Math.round(gb * 1024 * 1024 * 1024);
}

type Zeile = {
  project_id: string;
  size_bytes: number | null;
  deleted_at?: string | null;
};

/**
 * Wie viel Speicher belegen die hochgeladenen Dateien – gesamt und je Projekt.
 *
 * Nur für uns: Ein Lieferant erführe daraus, wie viel die anderen Firmen
 * hochgeladen haben. Gezählt werden die Grössen aus der Datenbank; die kleinen
 * Vorschaubilder kommen im Bucket noch dazu und sind hier nicht enthalten.
 */
export const GET = handler(async () => {
  await requireAdmin();
  const db = serviceClient();

  const { data: projekte } = await db.from('projects').select('id, name');

  // Ohne Migration 0017 gibt es die Spalte deleted_at noch nicht – dann zählt
  // eben alles als aktiv, statt dass die Ansicht ganz ausfällt.
  const mitPapierkorb = await db
    .from('files')
    .select('project_id, size_bytes, deleted_at');

  const roh = mitPapierkorb.error
    ? await db.from('files').select('project_id, size_bytes')
    : mitPapierkorb;

  if (roh.error) {
    return ok({
      gesamt: 0,
      papierkorb: 0,
      anzahl: 0,
      grenze: grenzeInBytes(),
      projekte: [],
      fehler: roh.error.message,
    });
  }

  const zeilen = (roh.data ?? []) as Zeile[];
  const namen = new Map((projekte ?? []).map((p) => [p.id, p.name]));

  const proProjekt = new Map<string, { bytes: number; anzahl: number }>();
  let gesamt = 0;
  let papierkorb = 0;

  for (const zeile of zeilen) {
    const bytes = zeile.size_bytes ?? 0;
    gesamt += bytes;
    if (zeile.deleted_at) papierkorb += bytes;

    const bisher = proProjekt.get(zeile.project_id) ?? { bytes: 0, anzahl: 0 };
    proProjekt.set(zeile.project_id, {
      bytes: bisher.bytes + bytes,
      anzahl: bisher.anzahl + 1,
    });
  }

  const liste = [...proProjekt.entries()]
    .map(([id, wert]) => ({
      id,
      name: namen.get(id) ?? 'Gelöschtes Projekt',
      bytes: wert.bytes,
      anzahl: wert.anzahl,
    }))
    .sort((a, b) => b.bytes - a.bytes);

  return ok({
    gesamt,
    papierkorb,
    anzahl: zeilen.length,
    grenze: grenzeInBytes(),
    projekte: liste,
  });
});
