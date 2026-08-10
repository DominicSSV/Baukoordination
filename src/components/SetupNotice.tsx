/**
 * Wird angezeigt, solange die Supabase-Zugangsdaten fehlen. Besser eine klare
 * Anleitung als eine weisse Seite mit Serverfehler.
 */
export default function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="stripe-bar" />
        <div className="auth-body">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-logo" src="/logo.png" alt="Swiss Solar Ventures AG" />
          <h1>Einrichtung fehlt noch</h1>
          <p>
            Die App ist bereit, es fehlen aber die Zugangsdaten zu Supabase. Lege im
            Projektverzeichnis eine Datei <strong>.env.local</strong> an (bzw. hinterlege
            die Werte in den Vercel-Projekteinstellungen) und trage folgende Variablen
            ein:
          </p>
          <ul style={{ fontSize: 13, lineHeight: 1.7, paddingLeft: 18, margin: '0 0 14px' }}>
            {missing.map((key) => (
              <li key={key}>
                <code>{key}</code>
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>
            Die vollständige Anleitung inklusive des SQL-Skripts für die Datenbank steht
            in der <strong>README.md</strong> im Projektverzeichnis.
          </p>
        </div>
      </div>
    </div>
  );
}
