import type { MetadataRoute } from 'next';

/**
 * Damit die App auf dem Handy als eigenes Symbol auf dem Startbildschirm liegt.
 *
 * "display: browser" ist Absicht: In der abgekoppelten Ansicht ("standalone")
 * hätte das Symbol einen eigenen Cookie-Speicher. Ein Anmelde-Link aus der
 * E-Mail öffnet sich aber immer in Safari – man wäre dann dort angemeldet und
 * im Symbol weiterhin ausgeloggt. Solange die Anmeldung über E-Mail-Links
 * läuft, ist der Umweg über den Browser der verlässlichere Weg.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Baukoordination – Swiss Solar Ventures AG',
    short_name: 'Baukoordination',
    description:
      'Projekte, Lieferanten, To-Dos und Dateien der Swiss Solar Ventures AG',
    start_url: '/',
    display: 'browser',
    background_color: '#262624',
    theme_color: '#262624',
    lang: 'de',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
