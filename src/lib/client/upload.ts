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

export type UploadResult = {
  uploaded: number;
  errors: string[];
};

/**
 * Lädt Dateien direkt vom Browser in den Supabase-Storage – der Server stellt nur
 * die Signed URLs aus und schreibt danach den Datensatz. Dadurch gibt es keine
 * Grössenbeschränkung durch Serverless-Funktionen.
 */
export async function uploadFiles(params: {
  projectId: string;
  todoId?: string | null;
  files: FileList | File[];
}): Promise<UploadResult> {
  const list = Array.from(params.files);
  const errors: string[] = [];
  let uploaded = 0;

  for (const file of list) {
    try {
      let thumbBlob: Blob | null = null;
      try {
        thumbBlob = await makeThumbnail(file);
      } catch (e) {
        console.warn('[upload] Vorschau fehlgeschlagen', e);
      }

      const prepared = await post<PrepareResponse>(
        `/api/projects/${params.projectId}/files/prepare`,
        {
          name: file.name,
          mimeType: file.type,
          withThumb: Boolean(thumbBlob),
          todoId: params.todoId ?? undefined,
        },
      );

      const storage = browserClient().storage.from(prepared.bucket);

      const main = await storage.uploadToSignedUrl(
        prepared.storagePath,
        prepared.token,
        file,
        { contentType: file.type || 'application/octet-stream' },
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

      await post(`/api/projects/${params.projectId}/files/confirm`, {
        fileId: prepared.fileId,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath: prepared.storagePath,
        thumbPath,
        todoId: params.todoId ?? undefined,
      });

      uploaded += 1;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unbekannter Fehler';
      errors.push(`"${file.name}": ${reason}`);
    }
  }

  return { uploaded, errors };
}
