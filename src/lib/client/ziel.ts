/**
 * Wohin es nach erfolgreicher Anmeldung geht.
 *
 * Kommt jemand über einen geteilten Link (z.B. aus WhatsApp), steht das Ziel im
 * Parameter "next". Erlaubt sind ausschliesslich Pfade innerhalb der App: Eine
 * vollständige Adresse würde man sonst unterschieben, um gerade Angemeldete auf
 * eine fremde Seite zu schicken. Doppelte Schrägstriche fangen wir mit ab, denn
 * "//example.com" ist für den Browser bereits eine fremde Adresse.
 */
export function zielNachAnmeldung(): string {
  if (typeof window === 'undefined') return '/app';
  const next = new URLSearchParams(window.location.search).get('next');
  return next && /^\/app(\?[^\s]*)?$/.test(next) ? next : '/app';
}
