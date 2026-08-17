import { fmtSize } from '@/lib/format';

/**
 * Grösse, die eine einzelne Datei höchstens haben darf.
 *
 * Die Grenze setzt Supabase, nicht wir: Im kostenlosen Plan sind es 50 MB pro
 * Datei, mehr lässt der Speicher gar nicht erst zu. Wird das Kontingent dort
 * angehoben, kann man hier mit NEXT_PUBLIC_MAX_UPLOAD_MB nachziehen.
 *
 * Wir prüfen im Browser mit, damit man es erfährt, bevor der Upload losläuft –
 * und in verständlichem Deutsch statt als englische Meldung aus dem Speicher.
 */
export const MAX_UPLOAD_MB = (() => {
  const roh = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB);
  return Number.isFinite(roh) && roh > 0 ? roh : 50;
})();

export const MAX_UPLOAD_BYTES = Math.round(MAX_UPLOAD_MB * 1024 * 1024);

/**
 * Bilder werden vor dem Hochladen verkleinert – ein 60-MB-Foto kommt als
 * gut 1 MB an. Für sie sagt die rohe Grösse nichts aus; geprüft wird erst,
 * was tatsächlich hochgeht.
 */
export function vorabZuGross(file: File): boolean {
  if (file.type.startsWith('image/')) return false;
  return file.size > MAX_UPLOAD_BYTES;
}

/** Klartext für die Meldung – überall derselbe Wortlaut. */
export function zuGrossText(groesse: number): string {
  return `${fmtSize(groesse)} sind zu gross – erlaubt sind ${MAX_UPLOAD_MB} MB pro Datei.`;
}
