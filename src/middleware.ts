import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Hält die Supabase-Auth-Session des Admins frisch. Ohne diesen Schritt läuft das
 * Access-Token nach einer Stunde ab und der Admin fliegt mitten in der Arbeit raus.
 *
 * Die Lieferanten-Session braucht das nicht: sie liegt als eigenes Cookie mit
 * 30 Tagen Laufzeit vor und wird pro Anfrage gegen die Datenbank geprüft.
 */
export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Seitenaufrufe erneuern die Session. Statische Dateien brauchen sie nicht, und
     * /api ist bewusst ausgenommen: die Route-Handler bauen ihren eigenen Client auf
     * und erneuern das Token dort selbst – ein zweiter Aufruf pro API-Request wäre
     * nur zusätzliche Latenz.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
