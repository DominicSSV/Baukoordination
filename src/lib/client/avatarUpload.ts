'use client';

import { api, post } from '@/lib/client/api';
import { browserClient } from '@/lib/supabase/browser';

type Vorbereitet = { bucket: string; path: string; token: string };

/**
 * Verkleinert das Bild auf ein Quadrat und schneidet mittig zu – so sieht der
 * runde Kreis immer sauber aus, egal ob Hoch- oder Querformat hochgeladen wurde.
 */
async function quadratischVerkleinern(file: File, kante = 320): Promise<Blob> {
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

  const seite = Math.min(bild.width, bild.height);
  const links = (bild.width - seite) / 2;
  const oben = (bild.height - seite) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = kante;
  canvas.height = kante;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas-Kontext nicht verfügbar');
  ctx.drawImage(bild, links, oben, seite, seite, 0, 0, kante, kante);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Bild konnte nicht verarbeitet werden');
  return blob;
}

/** Lädt ein Profilbild hoch und gibt die Anzeige-URL zurück. */
export async function uploadAvatar(
  file: File,
  supplierId?: string | null,
): Promise<string | null> {
  const blob = await quadratischVerkleinern(file);

  const vorbereitet = await post<Vorbereitet>('/api/avatar', {
    supplierId: supplierId ?? undefined,
  });

  const upload = await browserClient()
    .storage.from(vorbereitet.bucket)
    .uploadToSignedUrl(vorbereitet.path, vorbereitet.token, blob, {
      contentType: 'image/jpeg',
    });

  if (upload.error) throw new Error(upload.error.message);

  const { avatar_url } = await api<{ avatar_url: string | null }>('/api/avatar', {
    method: 'PUT',
    body: JSON.stringify({ supplierId: supplierId ?? undefined, path: vorbereitet.path }),
  });

  return avatar_url;
}

export async function removeAvatar(supplierId?: string | null): Promise<void> {
  const query = supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : '';
  await api(`/api/avatar${query}`, { method: 'DELETE' });
}
