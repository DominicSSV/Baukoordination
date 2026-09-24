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
hast. Damit funktioniert es mit OneDrive, Dropbox, kDrive und jedem anderen
gleich gut, und deine Zugangsdaten zur Cloud liegen nirgends im Programm.

**Auf dem Mac** (läuft, sobald der Rechner an ist):

```bash
# Einmalig einrichten
crontab -e
# Diese Zeile einfügen – jeden Tag um 19:00:
0 19 * * * cd /PFAD/ZU/Baukoordination && /usr/local/bin/node scripts/sicherung.mjs --ziel "$HOME/OneDrive/Baukoordination" >> "$HOME/sicherung.log" 2>&1
```

**Auf Windows**: Aufgabenplanung → Einfache Aufgabe erstellen → Täglich →
Programm `node`, Argumente `scripts\sicherung.mjs --ziel "%USERPROFILE%\OneDrive\Baukoordination"`,
Starten in: der Projektordner.

Wichtig: Der Rechner muss zur eingestellten Zeit laufen. Wähle eine Zeit, zu
der er ohnehin an ist – 19:00 ist besser als 03:00.

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
