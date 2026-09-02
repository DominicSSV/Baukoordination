'use client';

import { api, post } from '@/lib/client/api';
import { browserClient } from '@/lib/supabase/browser';

type Vorbereitet = { bucket: string; path: string; token: string };

/**
 * Verkleinert ein Bild auf eine Höchstkante, ohne zuzuschneiden.
 *
 * Anders als beim Profilbild bleibt das Seitenverhältnis erhalten: Ein Haus ist
 * kein Kreis, und ein quadratisch beschnittenes Gebäude verliert genau das,
 * worauf es ankommt – das Dach oder die Zufahrt.
 *
 * Verkleinert wird trotzdem, und zwar im Browser: Ein Handyfoto hat gut zwölf
 * Megapixel. Auf der Baustelle über Mobilfunk hochgeladen dauert das ewig, und
 * angezeigt wird es ohnehin nur ein paar hundert Pixel breit.
 */
async function verkleinern(file: File, hoechstkante = 1600): Promise<Blob> {
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

  // Kleine Bilder bleiben, wie sie sind – Hochrechnen macht sie nur unscharf.
  const faktor = Math.min(1, hoechstkante / Math.max(bild.width, bild.height));
  const breite = Math.round(bild.width * faktor);
  const hoehe = Math.round(bild.height * faktor);

  const canvas = document.createElement('canvas');
  canvas.width = breite;
  canvas.height = hoehe;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
  ctx.drawImage(bild, 0, 0, breite, hoehe);

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
  const blob = await verkleinern(file);

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
