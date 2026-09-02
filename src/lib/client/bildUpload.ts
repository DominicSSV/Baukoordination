'use client';

import { api, post } from '@/lib/client/api';
import { browserClient } from '@/lib/supabase/browser';

type Vorbereitet = { bucket: string; path: string; token: string };

/**
 * Schneidet mittig auf ein Quadrat zu und verkleinert.
 *
 * Quadratisch, damit die Kachel in jedem Projekt gleich aussieht – ob jemand
 * hoch oder quer fotografiert hat, soll die Ansicht nicht durcheinanderbringen.
 * Zugeschnitten wird schon hier und nicht erst beim Anzeigen: Sonst läge im
 * Speicher ein Bild, von dem man nur einen Teil je zu sehen bekommt.
 *
 * Mittig, weil ein Gebäude auf einem Foto in aller Regel in der Mitte steht.
 *
 * Verkleinert wird im Browser: Ein Handyfoto hat gut zwölf Megapixel. Auf der
 * Baustelle über Mobilfunk hochgeladen dauert das ewig, und angezeigt wird es
 * ohnehin nur ein paar hundert Pixel breit.
 */
async function quadratischVerkleinern(file: File, kante = 1200): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Bitte ein Bild auswählen (JPG oder PNG).');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Datei nicht lesbar'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

  const bild = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = dataUrl;
  });

  // Der grösste mittige Ausschnitt, der noch quadratisch ist.
  const seite = Math.min(bild.width, bild.height);
  const links = (bild.width - seite) / 2;
  const oben = (bild.height - seite) / 2;

  // Kleine Bilder bleiben, wie sie sind – Hochrechnen macht sie nur unscharf.
  const zielkante = Math.min(kante, seite);

  const canvas = document.createElement('canvas');
  canvas.width = zielkante;
  canvas.height = zielkante;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
  ctx.drawImage(bild, links, oben, seite, seite, 0, 0, zielkante, zielkante);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden');
  return blob;
}

/** Lädt das Bild der Liegenschaft hoch und gibt die Anzeige-URL zurück. */
export async function uploadProjektBild(
  projectId: string,
  file: File,
): Promise<string | null> {
  const blob = await quadratischVerkleinern(file);

  const vorbereitet = await post<Vorbereitet>(`/api/projects/${projectId}/bild`, {});

  const upload = await browserClient()
    .storage.from(vorbereitet.bucket)
    .uploadToSignedUrl(vorbereitet.path, vorbereitet.token, blob, {
      contentType: 'image/jpeg',
    });

  if (upload.error) throw new Error(upload.error.message);

  const { bildUrl } = await api<{ bildUrl: string | null }>(
    `/api/projects/${projectId}/bild`,
    { method: 'PUT', body: JSON.stringify({ path: vorbereitet.path }) },
  );

  return bildUrl;
}

export async function removeProjektBild(projectId: string): Promise<void> {
  await api(`/api/projects/${projectId}/bild`, { method: 'DELETE' });
}
