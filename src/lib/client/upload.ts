'use client';

import { post } from '@/lib/client/api';
import { browserClient } from '@/lib/supabase/browser';

type PrepareResponse = {
  fileId: string;
  bucket: string;
  storagePath: string;
  token: string;
  thumb: { path: string; token: string } | null;
};

/**
 * Erzeugt eine verkleinerte Vorschau für die Kachelansicht. Das Original wird
 * unverändert hochgeladen – anders als im Prototyp, der wegen des 5-MB-Limits jedes
 * Bild komprimieren musste.
 *
 * Schlägt die Vorschau fehl, ist das kein Grund den Upload abzubrechen: die Kachel
 * zeigt dann eben kein Bild. Der Fehler wird bewusst weitergereicht statt verschluckt.
 */
async function makeThumbnail(file: File, maxDim = 640, quality = 0.72): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Datei nicht lesbar'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = dataUrl;
  });

  let { width, height } = image;
  if (width > height && width > maxDim) {
    height = Math.round((height * maxDim) / width);
    width = maxDim;
  } else if (height > maxDim) {
    width = Math.round((width * maxDim) / height);
    height = maxDim;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
  ctx.drawImage(image, 0, 0, width, height);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/** Grösse, ab der ein Foto verkleinert wird. */
const FOTO_ZIEL = 1024 * 1024;
/** Längste Kante nach dem Verkleinern – reicht für Ausdruck und Zoom. */
const FOTO_KANTE = 2200;

/**
 * Verkleinert Fotos vor dem Hochladen auf etwa ein Megabyte.
 *
 * Ein Handyfoto wiegt heute 3 bis 6 MB. Auf der Baustelle dauert der Upload
 * damit im Mobilfunknetz spürbar länger, und der Speicherplatz ist schneller
 * voll, als einem lieb ist. 2200 Pixel an der langen Kante bleiben scharf genug,
 * um auf einem Bild etwas nachzumessen oder es auf A4 zu drucken.
 *
 * Gibt null zurück, wenn nichts zu tun ist – kleine Bilder, PDF, oder wenn der
 * Browser das Format nicht lesen kann. Dann wird das Original hochgeladen.
 */
async function verkleinern(
  file: File,
): Promise<{ blob: Blob; name: string; type: string } | null> {
  if (!file.type.startsWith('image/')) return null;
  if (file.size <= FOTO_ZIEL) return null;

  try {
    const bild = await ladeBild(file);

    let { width, height } = bild;
    const groesste = Math.max(width, height);
    if (groesste > FOTO_KANTE) {
      const faktor = FOTO_KANTE / groesste;
      width = Math.round(width * faktor);
      height = Math.round(height * faktor);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bild, 0, 0, width, height);

    // Von guter zu sparsamer Qualität, bis das Bild klein genug ist.
    for (const guete of [0.85, 0.75, 0.65, 0.55]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', guete),
      );
      if (!blob) return null;
      if (blob.size <= FOTO_ZIEL || guete === 0.55) {
        // Nur übernehmen, wenn es sich lohnt.
        if (blob.size >= file.size) return null;
        return {
          blob,
          name: file.name.replace(/\.[^.]+$/, '') + '.jpg',
          type: 'image/jpeg',
        };
      }
    }
    return null;
  } catch (e) {
    console.warn('[upload] Verkleinern übersprungen', e);
    return null;
  }
}

async function ladeBild(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild nicht lesbar'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type UploadResult = {
  uploaded: number;
  errors: string[];
  /** Summe der aus PDF ausgelesenen Offertenbeträge, 0 = keiner erkannt. */
  betraege: number;
  /** Erklärung, falls ein Betrag nicht ausgelesen werden konnte. */
  betragHinweis: string | null;
};

/**
 * Lädt Dateien direkt vom Browser in den Supabase-Storage – der Server stellt nur
 * die Signed URLs aus und schreibt danach den Datensatz. Dadurch gibt es keine
 * Grössenbeschränkung durch Serverless-Funktionen.
 */
export async function uploadFiles(params: {
  projectId: string;
  todoId?: string | null;
  /** Ordner im Register "Offerten"; leer = gewöhnliche Datei. */
  offerFolder?: string | null;
  files: FileList | File[];
  /**
   * Angezeigte Namen, in derselben Reihenfolge wie die Dateien. Fehlt ein
   * Eintrag, gilt der ursprüngliche Dateiname.
   */
  namen?: string[];
  /** Von Hand erfasste Beträge, in derselben Reihenfolge wie die Dateien. */
  betraege?: Array<number | null>;
}): Promise<UploadResult> {
  const list = Array.from(params.files);
  const errors: string[] = [];
  let uploaded = 0;
  let betraege = 0;
  let betragHinweis: string | null = null;

  for (const [index, file] of list.entries()) {
    const anzeigename = params.namen?.[index]?.trim() || file.name;
    try {
      // Fotos werden vor dem Hochladen verkleinert; alles andere geht so, wie es ist.
      const klein = await verkleinern(file);
      const inhalt: Blob = klein?.blob ?? file;
      const mimeType = klein?.type ?? file.type;

      let thumbBlob: Blob | null = null;
      try {
        thumbBlob = await makeThumbnail(file);
      } catch (e) {
        console.warn('[upload] Vorschau fehlgeschlagen', e);
      }

      const prepared = await post<PrepareResponse>(
        `/api/projects/${params.projectId}/files/prepare`,
        {
          name: anzeigename,
          mimeType,
          withThumb: Boolean(thumbBlob),
          todoId: params.todoId ?? undefined,
          offerFolder: params.offerFolder ?? undefined,
          betrag: params.betraege?.[index] ?? undefined,
        },
      );

      const storage = browserClient().storage.from(prepared.bucket);

      const main = await storage.uploadToSignedUrl(
        prepared.storagePath,
        prepared.token,
        inhalt,
        { contentType: mimeType || 'application/octet-stream' },
      );
      if (main.error) throw new Error(main.error.message);

      let thumbPath: string | null = null;
      if (thumbBlob && prepared.thumb) {
        const thumbUpload = await storage.uploadToSignedUrl(
          prepared.thumb.path,
          prepared.thumb.token,
          thumbBlob,
          { contentType: 'image/jpeg' },
        );
        if (thumbUpload.error) {
          console.warn('[upload] Vorschau nicht gespeichert', thumbUpload.error);
        } else {
          thumbPath = prepared.thumb.path;
        }
      }

      const bestaetigt = await post<{
        betragErkannt?: number | null;
        betragHinweis?: string | null;
      }>(
        `/api/projects/${params.projectId}/files/confirm`,
        {
          fileId: prepared.fileId,
          name: anzeigename,
          mimeType,
          sizeBytes: inhalt.size,
          storagePath: prepared.storagePath,
          thumbPath,
          todoId: params.todoId ?? undefined,
          offerFolder: params.offerFolder ?? undefined,
          betrag: params.betraege?.[index] ?? undefined,
        },
      );

      if (bestaetigt.betragErkannt) betraege += bestaetigt.betragErkannt;
      if (bestaetigt.betragHinweis) betragHinweis = bestaetigt.betragHinweis;
      uploaded += 1;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unbekannter Fehler';
      errors.push(`"${anzeigename}": ${reason}`);
    }
  }

  return { uploaded, errors, betraege, betragHinweis };
}
