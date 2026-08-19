import type { Metadata, Viewport } from 'next';
import { Anton, Poppins } from 'next/font/google';
import './globals.css';

const anton = Anton({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-anton',
  display: 'swap',
});

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-poppins',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Baukoordination – Swiss Solar Ventures AG',
  description: 'Projekte, Lieferanten, To-Dos und Dateien der Swiss Solar Ventures AG',
  // Auf dem Startbildschirm des Handys erscheint das Haus-Zeichen auf dunklem
  // Grund – iOS nimmt dafür ausschliesslich das apple-touch-icon.
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: { url: '/apple-touch-icon.png', sizes: '180x180' },
  },
  // Kurzer Name unter dem Symbol, sonst schreibt iOS den ganzen Titel hin.
  // capable: false ist Absicht – siehe die Begründung in app/manifest.ts.
  appleWebApp: { capable: false, title: 'Baukoordination' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Färbt die Browserleiste des Handys oberhalb der App. Muss der Kopfzeile
  // folgen, sonst sitzt ein dunkler Streifen über dem weissen Balken.
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" className={`${anton.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
