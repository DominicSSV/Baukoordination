# Baukoordination – Swiss Solar Ventures AG

Produktivversion des Artifact-Prototyps: gleiche Oberfläche und gleiche Abläufe, aber mit
echtem Backend (Supabase), echter Authentifizierung, echtem Mailversand und ohne
Grössenbeschränkung für Dateien.

**Stack:** Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage) · Resend · Vercel

---

## 1. Einrichtung in vier Schritten

### Schritt 1: Datenbank anlegen

Im Supabase-Dashboard → **SQL Editor** den kompletten Inhalt von
[`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) einfügen und
ausführen. Das Skript legt an:

- alle Tabellen samt Indizes,
- die Rollen-Helfer `is_admin()`, `current_supplier_id()`, `has_project_access()`,
- sämtliche RLS-Policies,
- den Schreib-Wächter, der Lieferanten davon abhält, fremde To-Dos zu verändern,
- die View `supplier_public` (Lieferantennamen ohne Zugangscodes),
- den privaten Storage-Bucket `project-files`.

Das Skript ist idempotent und darf gefahrlos mehrfach laufen.

### Schritt 2: Umgebungsvariablen setzen

`.env.example` nach `.env.local` kopieren und ausfüllen:

```bash
cp .env.example .env.local
```

| Variable | Wo im Supabase-Dashboard | Pflicht |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → Data API | ja |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API Keys → `anon` | ja |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → `service_role` | ja |
| `SUPABASE_JWT_SECRET` | Project Settings → JWT Keys → JWT Secret (HS256/Legacy) | dringend empfohlen |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys | für Mailversand |
| `MAIL_FROM` | verifizierte Absenderadresse bei Resend | für Mailversand |
| `NEXT_PUBLIC_APP_URL` | eigene Domain, z.B. `https://baukoordination.swiss-sv.ch` | optional |

`.env.local` steht in `.gitignore` und darf **nie** eingecheckt werden. Der
`service_role`-Key umgeht sämtliche RLS-Regeln und wird ausschliesslich serverseitig
verwendet – er taucht in keinem Frontend-Bundle auf.

> **Zu `SUPABASE_JWT_SECRET`:** Damit signiert der Server die kurzlebigen
> Lieferanten-Tokens, über die Postgres die RLS-Policies auch für Lieferanten anwendet.
> Fehlt der Wert, läuft die App weiter, greift für Lieferanten aber nur noch die Prüfung
> in den API-Routen – die Datenbank prüft dann nicht mehr mit. Die App weist in dem Fall
> oben mit einem roten Balken darauf hin.

### Schritt 3: Ersten Admin anlegen

Im Supabase-Dashboard → **Authentication → Users → Add user** einen Benutzer mit E-Mail
und Passwort anlegen. Der **erste** angelegte Auth-Benutzer wird automatisch als
Bauherrenvertreter freigeschaltet (Trigger `on_auth_user_created`).

Jeder weitere Account muss bewusst freigeschaltet werden – sonst wäre jede
Selbstregistrierung sofort ein Admin:

```sql
insert into public.admins (user_id, name, email)
select id, 'Vorname Nachname', email from auth.users where email = 'kollege@swiss-sv.ch';
```

Wer sich anmeldet, ohne freigeschaltet zu sein, bekommt auf `/admin` einen Hinweis mit
dem passenden SQL-Befehl statt einer weissen Seite.

Empfehlung: unter **Authentication → Providers → Email** die Selbstregistrierung
deaktivieren.

### Schritt 4: Starten

```bash
npm install
npm run dev        # http://localhost:3000
```

---

## 2. Deployment auf Vercel

1. Repository in Vercel importieren (Framework wird automatisch als Next.js erkannt).
2. Unter **Settings → Environment Variables** dieselben Variablen wie in `.env.local`
   hinterlegen – für Production, Preview und Development.
3. Deployen. `NEXT_PUBLIC_APP_URL` auf die endgültige Domain setzen, damit die Links in
   den Einladungs-E-Mails stimmen.
4. Bei Magic-Link-Login: die Domain in Supabase unter **Authentication → URL
   Configuration → Redirect URLs** als `https://deine-domain/auth/callback` eintragen.

---

## 3. Wie die Anmeldung funktioniert

| | Bauherrenvertreter | Lieferant |
| --- | --- | --- |
| Einstieg | `/admin` | `/` (Standardsicht) |
| Verfahren | Supabase Auth, E-Mail/Passwort oder Magic Link | 6-stelliger Zugangscode |
| Sitzung | Supabase-Auth-Cookie, von der Middleware erneuert | eigenes Cookie, 30 Tage, in `supplier_sessions` hinterlegt und jederzeit widerrufbar |
| Datenbankzugriff | Rolle `authenticated`, RLS greift | pro Anfrage frisch signiertes JWT mit `supplier_id`, RLS greift |

Wer den Link zum ersten Mal öffnet, landet direkt auf dem Code-Eingabefeld – nicht auf
einer allgemeinen Startseite. Der Weg zum Admin-Login ist ein unauffälliger `/admin`-Pfad
statt eines geteilten Geheim-Codes wie im Prototyp.

Meldet sich jemand im selben Browser als Lieferant an, hat diese Sitzung Vorrang vor einer
noch offenen Adminsitzung; „abmelden“ stellt die Adminsicht wieder her.

---

## 4. Rechte im Überblick

Jede Sperre ist doppelt umgesetzt: sichtbar in der Oberfläche **und** serverseitig durch
RLS-Policies. Auf die reine UI-Sperre verlässt sich nichts.

| Aktion | Admin | Lieferant |
| --- | --- | --- |
| Projekte anlegen | ✅ | ❌ |
| Projekte sehen | alle | nur freigegebene |
| Lieferanten anlegen/bearbeiten/löschen | ✅ | ❌ |
| Zugriffsrechte ändern | ✅ | ❌ |
| To-Dos anlegen | ✅ | ❌ |
| To-Dos abhaken | ✅ | ✅ (in freigegebenen Projekten) |
| To-Dos inhaltlich ändern | alle | nur selbst erstellte |
| To-Dos löschen | ✅ | ❌ |
| Kommentieren | ✅ | ✅ |
| Kommentare löschen | alle | nur eigene |
| Dateien hochladen | ✅ | ✅ |
| Dateien löschen | alle | nur eigene Uploads |
| Zugangscodes anderer Lieferanten sehen | ✅ | ❌ |
| Update-Mail versenden | ✅ | ❌ |

Zwei Stellen verdienen einen genaueren Blick:

- **Spaltenweiser Schutz beim Abhaken.** RLS filtert Zeilen, aber keine Spalten. Ein
  Lieferant darf ein fremdes To-Do abhaken, aber nicht dessen Text oder Zuweisung ändern.
  Das erzwingt der Trigger `todos_supplier_update_guard` direkt in der Datenbank.
- **Fremde Lieferantendaten.** Ein Lieferant muss lesen können, wem eine Aufgabe
  zugewiesen ist. Dafür gibt es die View `supplier_public`, die nur Name, Firma und
  Gewerk von Lieferanten aus gemeinsamen Projekten liefert – ohne Zugangscode, ohne
  Telefonnummer, ohne E-Mail.

---

## 5. Dateien

- Privater Bucket `project-files`, Pfadschema `{project_id}/{file_id}-{dateiname}`.
- Der Upload läuft **direkt vom Browser** in den Storage über eine vom Server
  ausgestellte Signed Upload URL. Die Datei geht also nie durch eine Serverless-Funktion –
  damit gibt es weder das 5-MB-Limit des Prototyps noch die 4.5-MB-Grenze von Vercel.
- Zu jedem Bild wird zusätzlich eine verkleinerte Vorschau (max. 640 px) abgelegt, damit
  die Kachelansicht auch mit vielen Baustellenfotos schnell bleibt. Das Original bleibt
  unverändert.
- Heruntergeladen und angezeigt wird über kurzlebige Signed URLs, die der Server erst
  nach der Zugriffsprüfung ausstellt. Der Bucket selbst ist von aussen nicht erreichbar.
- Eine Datei kann an ein To-Do gebunden sein (`todo_id`); sie erscheint dann beim To-Do
  **und** im Dateien-Tab mit einem Verweis auf die zugehörige Aufgabe.

---

## 6. E-Mail

Der Versand läuft über [Resend](https://resend.com).

- **Einladung:** ein Klick auf „✉️ Einladen“ verschickt die Mail mit Zugangscode und Link
  direkt an den Lieferanten.
- **Update senden:** fasst die letzten 15 Protokolleinträge zusammen und schickt sie an
  alle Lieferanten mit Zugriff auf das Projekt.
- **Benachrichtigung pro Aktion:** mit `NOTIFY_ON_EVERY_ACTIVITY=true` geht bei jeder
  einzelnen Aktivität sofort eine Mail raus. Standardmässig aus, sonst wird es bei regem
  Betrieb sehr viel Post.

Ist kein `RESEND_API_KEY` hinterlegt oder scheitert der Versand, verschwindet die Aktion
nicht stillschweigend: Es öffnet sich derselbe Dialog wie im Prototyp mit fertigem Text
zum Kopieren (Klick markiert alles) und einem echten `mailto:`-Link.

---

## 7. Projektstruktur

```
supabase/migrations/0001_init.sql   Schema, Policies, Trigger, Bucket
src/app/
  page.tsx                          Startseite = Lieferanten-Code-Eingabe
  admin/page.tsx                    Admin-Login (Supabase Auth)
  auth/callback/route.ts            Magic-Link-Einlösung
  app/page.tsx                      Arbeitsbereich (Server-Einstieg)
  api/…                             REST-Routen, jede mit eigener Rechteprüfung
src/components/
  workspace/                        Sidebar, Tabs, Modals
  Feedback.tsx                      Toasts und eigener Bestätigungsdialog
src/lib/
  auth/                             Session-Auflösung und Guards
  supabase/                         Clients: Auth, Lieferanten-JWT, service_role
  projects.ts                       Laden eines Projekts samt Signed URLs
  email.ts                          Resend-Vorlagen im SSV-Look
```

---

## 8. Übernommene UX-Prinzipien

- **Nichts scheitert stumm.** Jede API-Route wirft im Fehlerfall eine lesbare Meldung,
  der Client zeigt sie als Toast. Auch Teilfehler werden gemeldet: Wenn etwa ein To-Do
  gespeichert wurde, aber der Protokolleintrag scheiterte, steht genau das im Hinweis.
  Beim Mehrfach-Upload wird pro Datei berichtet, welche durchging und welche nicht.
- **Eigene Dialoge statt `confirm()`/`alert()`.** Alle Rückfragen laufen über einen
  gestalteten Dialog im Erscheinungsbild der App.
- **Sortieren per Pfeil-Buttons**, kein Drag & Drop – auf dem Handy zuverlässiger.
- **Design 1:1 aus dem Prototyp:** Farben, Abstände, Schriften (Anton/Poppins), der
  Gelb→Grün-Verlauf am Projekt-Header, der Stempel-Effekt beim Abhaken und das
  Mobile-Layout mit horizontal scrollender Projektleiste.

---

## 9. Befehle

```bash
npm run dev         # Entwicklungsserver
npm run build       # Produktions-Build
npm run start       # Produktions-Build lokal starten
npm run lint        # ESLint
npm run typecheck   # TypeScript ohne Ausgabe
```
