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
  // Die Symbole liegen bewusst als icon.png, icon1.png und apple-icon.png neben
  // dieser Datei, statt hier von Hand auf /public zu zeigen.
  //
  // Grund: Browser merken sich das Symbol eines Tabs sehr hartnäckig. Zeigt der
  // Verweis immer auf dieselbe Adresse, holt der Browser die Datei nie wieder –
  // das schwarze Symbol blieb selbst nach dem Austausch stehen. Auf diesem Weg
  // hängt Next.js an die Adresse eine Prüfsumme des Bildes; ändert sich das
  // Bild, ändert sich die Adresse, und der Browser lädt es neu.
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
