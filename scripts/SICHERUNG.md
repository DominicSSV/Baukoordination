# Sicherung und Wiederherstellung

Wie die Daten der Baukoordination gesichert werden, was das schützt und was
nicht – und wie man im Ernstfall zurückkommt.

## Der Grundsatz

Eine Kopie ist erst dann eine Sicherung, wenn sie **woanders liegt als das
Original**. Die Sicherung, die Supabase anlegt, liegt bei Supabase. Geht das
Konto verloren, wird das Projekt versehentlich gelöscht oder läuft die
Rechnung aus, sind Daten und Sicherung im selben Moment weg.

Deshalb gilt die Dreierregel: **drei Kopien, zwei verschiedene Orte, eine
ausserhalb.**

| Kopie | Wo | Wer sorgt dafür |
|---|---|---|
| Die Daten selbst | Supabase | Supabase |
| Tägliche Sicherung | Supabase | Supabase, **nur im Pro-Plan** |
| Eigene Kopie | dein Rechner, externe Platte | **du**, mit diesem Skript |

## Was Supabase selbst sichert

Nachzusehen unter **Supabase → Database → Backups**.

- **Kostenloser Plan: keine automatischen Sicherungen.** Die Daten sind nur
  einmal vorhanden. Wer hier steht, hat keine Sicherung, sondern Glück.
- **Pro-Plan:** tägliche Sicherung der Datenbank, sieben Tage aufbewahrt.
- **Point-in-Time-Recovery** (Rückkehr auf die Minute genau) kostet extra.

Wichtig: Prüfe im Dashboard ausdrücklich, ob der **Dateispeicher** (Storage)
in der Sicherung enthalten ist. Die Sicherung der Datenbank deckt die Tabellen
ab – die hochgeladenen Fotos, Pläne und Offerten liegen daneben. Verlass dich
nicht auf die Annahme, dass beides dasselbe ist.

## Die eigene Kopie

```bash
npm run sicherung
npm run sicherung -- --ziel "/Users/dominic/OneDrive/Baukoordination"
```

Das Skript braucht `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`.
Stehen sie nicht in der Umgebung, liest es sie aus `.env.local`. Beide findest
du in Vercel unter Settings → Environment Variables.

Es entsteht eine **lesbare Ordnerstruktur** – je Projekt ein Ordner:

```
Baukoordination-2026-09-24/
  LIESMICH.md
  Tägerwilen - PVA/
    Projektinfos.md      Objektangaben, Kontakte vor Ort, Firmen
    To-Dos.md            alle Aufgaben mit Frist, Zuständigen, Kommentaren
    Terminplan.md        Balkenplan als Tabelle, mit Rückmeldungen
    Protokoll.md         was wann von wem geschehen ist
    Auftragsbestätigungen/
    Nachträge/
    Dokumente/<Ordner>/<Unterordner>/
    Fotos/
    Dateien/
  _Datenbank/            alle Tabellen als JSON
  _Bilder/               Profilbilder
```

Die Dateien tragen **ihren Namen aus der App**, nicht die Kennung aus dem
Speicher. Wer die Sicherung öffnet, findet sich ohne Erklärung zurecht – das
ist der Punkt: Im Ernstfall braucht man die Pläne und die Abmachungen, nicht
die App.

Die `.md`-Dateien sind Text und lassen sich mit jedem Editor öffnen; in Word
oder einem Markdown-Programm sehen sie formatiert aus.

Bricht das Skript mit einem Fehler ab, ist die Sicherung **unvollständig**.
Das ist Absicht. Eine halbe Sicherung, die sich als ganze ausgibt, ist
gefährlicher als gar keine.

Die letzten **14** Sicherungen bleiben liegen, ältere räumt das Skript selbst
weg – sonst füllt sich die Cloud mit fünfzig Kopien derselben Fotos.

## Täglich und von selbst

Das Skript weiss nichts von einer Cloud, und das ist Absicht: Es schreibt in
einen Ordner, und den Rest macht der Synchronisierungsdienst, den du ohnehin
hast. Damit funktioniert es mit OneDrive, SharePoint, Dropbox und kDrive
gleich gut, und deine Zugangsdaten zur Cloud liegen nirgends im Programm.

### Einrichten auf Windows – einmalig

Aufwand: **rund eine halbe Stunde**, davon die Hälfte Warten. Nichts davon
verlangt Programmierkenntnisse – es ist Herunterladen, Doppelklicken und
zweimal etwas Kopieren.

#### Schritt 1 – Node.js installieren (5 Minuten)

Node.js ist das Programm, das JavaScript ausserhalb eines Browsers ausführen
kann. Es ist quelloffen, wird von der OpenJS Foundation (Teil der Linux
Foundation) gepflegt und gehört zu den meistbenutzten Werkzeugen der
Softwarewelt – die Baukoordination selbst läuft bei Vercel darauf.

1. **https://nodejs.org** aufrufen – die Adresse von Hand eintippen, nicht
   über eine Suchmaschine. Bei „node js download" stehen oben bezahlte
   Anzeigen, und darunter waren schon gefälschte Seiten.
2. Den grossen grünen Knopf mit **„LTS"** anklicken (LTS heisst: die
   Fassung mit Langzeitunterstützung, nicht die neueste Bastelversion).
3. Die heruntergeladene `.msi`-Datei ausführen.
4. Alles auf Standard lassen, nur die Lizenz bestätigen und auf „Weiter"
   klicken. Das Häkchen „Automatically install the necessary tools" kann
   **weg** – es wird nicht gebraucht.
5. **Rechner neu starten.** Ohne das findet Windows den Befehl `node` nicht.

#### Schritt 2 – Programmcode herunterladen (5 Minuten)

1. **https://github.com/DominicSSV/Baukoordination** öffnen
2. Oben rechts den grünen Knopf **„Code"** → **„Download ZIP"**
3. Die ZIP-Datei im Explorer suchen, **Rechtsklick → Alle extrahieren**
4. Als Ziel `C:\Users\DominicMaag\Documents` wählen
5. Der entpackte Ordner heisst `Baukoordination-claude-...`. **Umbenennen
   in `Baukoordination`** – kürzer und die Anleitung passt dann.

> **NICHT in den OneDrive-Ordner legen.** Gleich kommt der Schlüssel zur
> Datenbank in diesen Ordner. Läge er in `Liegenschaften - Dokumente`, hätte
> ihn jeder, der auf diese Bibliothek Zugriff hat – und damit Zugriff auf
> sämtliche Projekte, Dateien und Kontakte.
>
> `Dokumente` auf dem Rechner ist richtig. Nur die **Sicherung** geht nach
> OneDrive, nicht der Code.

#### Schritt 3 – Einrichtung starten (10 Minuten, meist Warten)

Im Ordner `Baukoordination\scripts` die Datei **`einrichten-windows.cmd`
doppelklicken**.

Sie fragt nach zwei Werten. Die holst du so:

1. **vercel.com** öffnen → dein Projekt anklicken
2. Oben **„Settings"** → links **„Environment Variables"**
3. Dort stehen `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`.
   Auf das **Auge** klicken, um den Wert sichtbar zu machen, dann markieren
   und mit `Strg+C` kopieren.
4. Im schwarzen Fenster mit **Rechtsklick** einfügen (`Strg+V` geht dort oft
   nicht) und **Enter** drücken.

Danach lädt sie ein paar Minuten die benötigten Bausteine und macht gleich
die erste Sicherung. Am Ende steht „Geschafft".

Beim ersten Mal erscheint vielleicht die Meldung **„Der Computer wurde durch
Windows geschützt"**. Das ist die Standardwarnung für jede nicht signierte
Datei. Auf **„Weitere Informationen"** → **„Trotzdem ausführen"**.

#### Schritt 4 – prüfen

Im Explorer nach

```
C:\Users\DominicMaag\Swiss Property Management AG\Liegenschaften - Dokumente\Swiss Solar Ventures AG\7. Baukoordination\2. Backup
```

Dort muss ein Ordner `Baukoordination-JJJJ-MM-TT` liegen, darin je Projekt
ein Unterordner und eine `LIESMICH.md`. OneDrive lädt ihn von selbst hoch –
erkennbar am grünen Häkchen neben dem Ordner.

### Täglich automatisch

**Bedingung: Der Rechner muss laufen.** Die App muss **nicht** offen sein – das
Skript holt die Daten selbst aus der Datenbank. Eine Internetverbindung
braucht es, sonst nichts.

Das Skript sichert **höchstens einmal pro Tag**. Wurde heute schon gesichert,
endet es sofort wieder. Deshalb darf es bei jeder Anmeldung starten – wer den
Rechner dreimal am Tag hochfährt, bekommt trotzdem eine Sicherung und nicht
drei.

Damit lässt sich einrichten, was man eigentlich will: **gesichert wird, wenn
der Rechner das erste Mal an ist.**

**Windows-Taste → „Aufgabenplanung" → Aufgabe erstellen** (nicht „Einfache
Aufgabe" – dort fehlen die beiden Häkchen weiter unten)

| Reiter | Eintrag |
|---|---|
| Allgemein | Name `Baukoordination Sicherung` |
| Trigger → Neu | **Bei Anmeldung**, „Aufgabe verzögern um: **2 Minuten**" |
| Trigger → Neu (zweiter) | **Täglich**, 19:00 |
| Aktionen → Neu | Programm starten: `C:\Users\DominicMaag\Documents\Baukoordination\scripts\sicherung-windows.cmd` |
| | Starten in: `C:\Users\DominicMaag\Documents\Baukoordination` |
| Bedingungen | Häkchen bei **„Nur starten, wenn folgende Netzwerkverbindung verfügbar ist: Beliebige Verbindung"** |
| Einstellungen | Häkchen bei **„Aufgabe so schnell wie möglich nach einem verpassten Start ausführen"** |

Die zwei Minuten Verzögerung bei der Anmeldung sind wichtig: Direkt nach dem
Hochfahren ist oft noch kein Netz da.

Was dabei herauskommt:

| Situation | Was passiert |
|---|---|
| Rechner läuft um 19:00 | Sicherung um 19:00 |
| Rechner war um 19:00 aus | Sicherung beim nächsten Hochfahren |
| Mehrmals am Tag angemeldet | Nur die erste Anmeldung sichert, danach nichts |
| Eine Woche nicht eingeschaltet | Sicherung beim nächsten Einschalten |
| Kein Internet | Kein Lauf, Nachholung beim nächsten Mal |

Nach einer grossen Änderung sofort nochmals sichern: `sicherung-windows.cmd`
doppelklicken geht nicht (heute ist ja schon gesichert), dafür in der
Eingabeaufforderung:

```cmd
cd %USERPROFILE%\Documents\Baukoordination
node scripts\sicherung.mjs --ziel "C:\Users\DominicMaag\Swiss Property Management AG\Liegenschaften - Dokumente\Swiss Solar Ventures AG\7. Baukoordination\2. Backup" --erzwingen
```

### Auf dem Mac

```bash
crontab -e
# Jeden Tag um 19:00:
0 19 * * * cd /PFAD/ZU/Baukoordination && /usr/local/bin/node scripts/sicherung.mjs --ziel "$HOME/OneDrive/Baukoordination" >> "$HOME/sicherung.log" 2>&1
```

## Vollständige Sicherung der Datenbank

Das JSON aus dem Skript ist zum Lesen und zum Wiederherstellen von Hand. Für
eine Sicherung, aus der sich die Datenbank **vollständig** zurückspielen lässt
– mit Beziehungen, Indizes und Zugriffsregeln – braucht es `pg_dump`.

Die Verbindungszeichenfolge steht in Supabase unter
**Settings → Database → Connection string → URI**.

```bash
pg_dump "postgresql://postgres:<passwort>@db.<projekt>.supabase.co:5432/postgres" \
  --clean --if-exists --no-owner --no-privileges \
  -f sicherung/datenbank-$(date +%F).sql
```

Zurückspielen in ein neues Projekt:

```bash
psql "postgresql://postgres:<passwort>@db.<neu>.supabase.co:5432/postgres" \
  -f sicherung/datenbank-2026-09-18.sql
```

## Wie oft

| | |
|---|---|
| Während aktiver Bauphasen | wöchentlich |
| Ruhige Zeiten | monatlich |
| Immer | **vor jeder Migration**, die Daten löscht oder umbaut |

Leg die Sicherung anschliessend auf eine externe Platte oder in einen
Cloud-Speicher, der nichts mit Supabase zu tun hat.

## Die Probe

Eine Sicherung, die nie zurückgespielt wurde, ist eine Vermutung.

Mindestens einmal: ein zweites, leeres Supabase-Projekt anlegen, die Migrationen
einspielen, den Dump zurückspielen, die App mit den neuen Schlüsseln starten.
Dauert einen Nachmittag und ist der einzige Weg, es sicher zu wissen.

## Was eine Sicherung nicht abdeckt

- **Versehentlich gelöscht und erst nach Wochen bemerkt.** Die sieben Tage bei
  Supabase sind dann abgelaufen. Dagegen hilft nur die eigene Kopie – und
  dass der Papierkorb in der App gelöschte Aufgaben ohnehin aufbewahrt.
- **Ein abgeflossener Dienstschlüssel.** Wer ihn hat, kommt an alles. Er
  gehört ausschliesslich in die Umgebungsvariablen von Vercel und niemals in
  den Code, in ein Mail oder in einen Chat.
