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
node scripts/sicherung.mjs
node scripts/sicherung.mjs --ziel /Volumes/Stick/baukoordination
```

Das Skript braucht `NEXT_PUBLIC_SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY`.
Stehen sie nicht in der Umgebung, liest es sie aus `.env.local`. Beide findest
du in Vercel unter Settings → Environment Variables.

Es entsteht ein Ordner mit dem Zeitstempel:

```
sicherung/2026-09-18-07-30-00/
  dateien/
    project-files/<projekt-id>/<datei>       alle Fotos, Pläne, Offerten
    avatars/                                  Profil- und Liegenschaftsbilder
  datenbank/
    projects.json  todos.json  files.json  …  jede Tabelle einzeln
  bericht.json                                was gesichert wurde, was fehlte
```

Die Dateien liegen danach als **richtige Dateien** auf der Platte. Du kannst
sie öffnen, ohne irgendetwas wiederherzustellen – das ist der Sinn: Im
schlimmsten Fall brauchst du die Pläne, nicht die App.

Bricht das Skript mit einem Fehler ab, ist die Sicherung **unvollständig**.
Das ist Absicht. Eine halbe Sicherung, die sich als ganze ausgibt, ist
gefährlicher als gar keine.

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
