import { randomUUID } from 'crypto';
import { ApiError, handler, ok, readJson, requireString } from '@/lib/api';
import { requireAdmin, requireProjectAccess, requireSession } from '@/lib/auth/guards';
import { AVATAR_BUCKET, signAvatars } from '@/lib/avatars';
import { serviceClient } from '@/lib/supabase/service';
import type { ProjektBild } from '@/types';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

/**
 * Die Bilder der Liegenschaft.
 *
 * Hinzufügen darf jeder mit Zugriff auf das Projekt – dieselbe Regel wie bei
 * den übrigen Projektinfos. Wer vor Ort steht, hat das Foto ohnehin schon auf
 * dem Handy; es erst über uns laufen zu lassen hiesse, dass es nie hochgeladen
 * wird.
 *
 * Entfernen bleibt bei uns: Ergänzen ist harmlos, Wegnehmen nicht.
 *
 * Der fehlende Ordner "projekte/<id>" wird nicht angelegt – im Ablageort
 * entsteht er mit der ersten Datei von selbst.
 */
function ordner(projectId: string): string {
  return `projekte/${projectId}`;
}

type BildZeile = {
  id: string;
  pfad: string;
  order_index: number;
  titel: string | null;
  created_at: string;
};

/**
 * Alle Bilder eines Projekts, in ihrer Reihenfolge, mit frischer Signatur.
 *
 * Ohne Migration 0047 gibt es die Tabelle nicht. Dann wird aus dem einen Bild
 * in projects.bild_path eine Liste mit einem Eintrag gebaut: Die Ansicht
 * funktioniert weiter, nur eben mit einem Bild.
 */
async function bilderLesen(projectId: string): Promise<ProjektBild[]> {
  const db = serviceClient();

  const liste = await db
    .from('project_bilder')
    .select('id, pfad, order_index, titel, created_at')
    .eq('project_id', projectId)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (liste.error) {
    const { data } = await db
      .from('projects')
      .select('bild_path')
      .eq('id', projectId)
      .maybeSingle();

    const pfad = (data as { bild_path?: string | null } | null)?.bild_path;
    if (!pfad) return [];

    const urls = await signAvatars([pfad]);
    return [{ id: pfad, pfad, url: urls.get(pfad) ?? null, titel: null }];
  }

  const zeilen = (liste.data ?? []) as unknown as BildZeile[];
  const urls = await signAvatars(zeilen.map((z) => z.pfad));

  return zeilen.map((z) => ({
    id: z.id,
    pfad: z.pfad,
    url: urls.get(z.pfad) ?? null,
    titel: z.titel,
  }));
}

/**
 * Das Titelbild in projects.bild_path nachführen.
 *
 * Doppelt gehalten, weil die Projektliste, die Sicherung und die
 * Gesundheitsprüfung diese Spalte lesen. Sie mitzuführen kostet hier drei
 * Zeilen und erspart es, fünf Stellen gleichzeitig umzubauen.
 */
async function titelbildNachfuehren(projectId: string, bilder: ProjektBild[]) {
  await serviceClient()
    .from('projects')
    .update({ bild_path: bilder[0]?.pfad ?? null })
    .eq('id', projectId);
}

/** Alle Bilder eines Projekts. */
export const GET = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  return ok({ bilder: await bilderLesen(projectId) });
});

/** Schritt 1: Upload vorbereiten. Der Browser lädt danach direkt in den Speicher. */
export const POST = handler(async (_request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  // Zufälliger Name pro Upload, damit ein ausgetauschtes Bild nicht aus dem
  // Zwischenspeicher des Browsers kommt.
  const pfad = `${ordner(projectId)}/${randomUUID()}.jpg`;

  const upload = await serviceClient()
    .storage.from(AVATAR_BUCKET)
    .createSignedUploadUrl(pfad);

  if (upload.error) {
    throw new ApiError(
      `Upload konnte nicht vorbereitet werden: ${upload.error.message}. `
        + `Existiert der Speicher "${AVATAR_BUCKET}" (Migration 0005)?`,
      500,
    );
  }

  return ok({ bucket: AVATAR_BUCKET, path: pfad, token: upload.data.token });
});

/**
 * Schritt 2: Nach dem Upload das Bild an die Liste anhängen.
 *
 * Angehängt und nicht ersetzt – das ist der ganze Unterschied zu früher. Wer
 * das zweite Foto hochlud, löschte damit bisher das erste.
 */
export const PUT = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ path?: string }>(request);
  const pfad = requireString(body.path, 'Pfad', 300);

  // Der Pfad kommt vom Browser zurück. Ohne diese Prüfung liesse sich damit das
  // Bild eines fremden Projekts oder ein Profilbild als eigenes ausgeben.
  if (!pfad.startsWith(`${ordner(projectId)}/`)) {
    throw new ApiError('Der gemeldete Pfad gehört nicht zu diesem Projekt.', 400);
  }

  const db = serviceClient();

  const letzte = await db
    .from('project_bilder')
    .select('order_index')
    .eq('project_id', projectId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (letzte.error) {
    // Ohne Migration 0047 bleibt es beim einen Bild: dann wie früher ersetzen,
    // damit das Hochladen wenigstens etwas bewirkt.
    const alt = await db
      .from('projects')
      .select('bild_path')
      .eq('id', projectId)
      .maybeSingle();

    const { error } = await db
      .from('projects')
      .update({ bild_path: pfad })
      .eq('id', projectId);

    if (error) {
      throw new ApiError(
        'Das Bild lässt sich erst nach der Datenbank-Aktualisierung 0034 '
          + `speichern: ${error.message}`,
        400,
      );
    }

    const vorher = (alt.data as { bild_path?: string | null } | null)?.bild_path;
    if (vorher && vorher !== pfad) {
      await db.storage.from(AVATAR_BUCKET).remove([vorher]);
    }

    return ok({ bilder: await bilderLesen(projectId), nurEines: true });
  }

  const naechste =
    ((letzte.data as { order_index: number } | null)?.order_index ?? -10) + 10;

  const { error } = await db
    .from('project_bilder')
    .insert({
      project_id: projectId,
      pfad,
      order_index: naechste,
      created_by: ctx.session.name,
    });

  if (error) {
    throw new ApiError(`Das Bild wurde nicht gespeichert: ${error.message}`, 500);
  }

  const bilder = await bilderLesen(projectId);
  await titelbildNachfuehren(projectId, bilder);

  return ok({ bilder });
});

/**
 * Reihenfolge ändern – damit auch: ein anderes Bild zum Titelbild machen.
 *
 * Die Reihenfolge kommt als vollständige Liste und nicht als "schiebe dieses
 * eine nach vorn": Bricht ein Tausch auf halbem Weg ab, hätten zwei Bilder
 * dieselbe Nummer und die Abfolge wäre danach Zufall.
 */
export const PATCH = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  const ctx = await requireSession();
  await requireProjectAccess(ctx, projectId);

  const body = await readJson<{ reihenfolge?: string[] }>(request);
  if (!Array.isArray(body.reihenfolge) || !body.reihenfolge.length) {
    throw new ApiError('Es war keine Reihenfolge dabei.', 400);
  }

  const db = serviceClient();
  let nummer = 0;

  for (const id of body.reihenfolge) {
    const { error } = await db
      .from('project_bilder')
      .update({ order_index: nummer })
      .eq('id', id)
      // Ohne diese Bedingung liesse sich über eine fremde Kennung das Bild
      // eines anderen Projekts verschieben.
      .eq('project_id', projectId);

    if (error) {
      throw new ApiError(
        `Die Reihenfolge wurde nicht gespeichert: ${error.message}. `
          + 'Fehlt Migration 0047?',
        500,
      );
    }
    nummer += 10;
  }

  const bilder = await bilderLesen(projectId);
  await titelbildNachfuehren(projectId, bilder);

  return ok({ bilder });
});

/**
 * Ein Bild entfernen – wie beim Löschen der übrigen Angaben nur für uns.
 *
 * Ohne Kennung werden alle entfernt. Das ist der alte Weg; die Ansicht
 * benutzt ihn nicht mehr, aber eine Datenbank ohne Migration 0047 kennt keine
 * einzelnen Bilder.
 */
export const DELETE = handler(async (request: Request, { params }: Params) => {
  const { id: projectId } = await params;
  await requireAdmin();

  let bildId: string | null = null;
  try {
    const body = await readJson<{ id?: string }>(request);
    bildId = typeof body.id === 'string' && body.id ? body.id : null;
  } catch {
    // Ohne Rumpf: alles entfernen, wie früher.
  }

  const db = serviceClient();
  const vorher = await bilderLesen(projectId);
  const weg = bildId ? vorher.filter((b) => b.id === bildId) : vorher;

  if (!weg.length) throw new ApiError('Dieses Bild gibt es nicht.', 404);

  const geloescht = bildId
    ? await db.from('project_bilder').delete().eq('id', bildId).eq('project_id', projectId)
    : await db.from('project_bilder').delete().eq('project_id', projectId);

  // Ohne Migration 0047 gibt es nur das eine Bild in der Spalte.
  if (geloescht.error) {
    const { error } = await db
      .from('projects')
      .update({ bild_path: null })
      .eq('id', projectId);

    if (error) {
      throw new ApiError(`Bild konnte nicht entfernt werden: ${error.message}`, 500);
    }
  }

  const bilder = await bilderLesen(projectId);
  await titelbildNachfuehren(projectId, bilder);

  // Erst aus der Liste, dann aus dem Speicher: Bleibt eine Datei liegen, ist
  // das unschön. Ein Eintrag, der auf eine gelöschte Datei zeigt, ist ein
  // kaputtes Bild in der Ansicht.
  const pfade = weg.map((b) => b.pfad).filter(Boolean);
  if (pfade.length) await db.storage.from(AVATAR_BUCKET).remove(pfade);

  return ok({ bilder });
});
