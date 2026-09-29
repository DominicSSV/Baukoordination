# ===========================================================================
#  Baukoordination – "Warum hat es nicht gesichert?"
#
#  Eine Aufgabe aus der Windows-Aufgabenplanung laeuft unsichtbar: Sie oeffnet
#  kein Fenster, und scheitert sie, schliesst sich alles wortlos. Dieses
#  Skript holt nach, was dabei verloren geht – es sieht der Reihe nach nach:
#
#    1. Gibt es den Auftrag ueberhaupt, und ist er eingeschaltet?
#    2. Wann lief er zuletzt, und mit welchem Ergebnis?
#    3. Zeigt er auf das Skript, das hier wirklich liegt?
#    4. Ist Node.js da, die .env.local, die Bausteine?
#    5. Gibt es den Zielordner – und wenn nicht: ab wo stimmt der Pfad nicht?
#    6. Was liegt aktuell an Sicherungen da?
#    7. Was sagt das Protokoll des letzten Laufs?
#
#  Am Ende steht alles auch in einer Textdatei neben diesem Skript.
#
#  Aufgerufen wird es ueber sicherung-pruefen.cmd (doppelklicken).
# ===========================================================================

$ErrorActionPreference = 'Continue'
$zeilen = New-Object System.Collections.ArrayList

function Sag($text = '') {
  [void]$zeilen.Add($text)
  Write-Host $text
}

function Titel($text) {
  Sag ''
  Sag ('--- ' + $text + ' ' + ('-' * [Math]::Max(0, 68 - $text.Length)))
}

$projekt = Split-Path -Parent $PSScriptRoot
$skript  = Join-Path $PSScriptRoot 'sicherung-windows.cmd'
$protokoll = Join-Path $PSScriptRoot 'sicherung.log'
$befunde = New-Object System.Collections.ArrayList

Sag '==========================================================='
Sag '  Baukoordination - Pruefung der taeglichen Sicherung'
Sag ('  ' + (Get-Date).ToString('dddd, dd.MM.yyyy HH:mm'))
Sag '==========================================================='
Sag ''
Sag ('Projektordner: ' + $projekt)

# --- 1-3) Der Auftrag in der Aufgabenplanung -------------------------------
Titel 'Auftrag in der Aufgabenplanung'

# Die Ergebniszahlen der Aufgabenplanung sind nicht lesbar gemeint. Die
# haeufigsten uebersetzt, damit nicht jeder Befund eine Suchmaschine braucht.
$bedeutung = @{
  0          = 'OK - der letzte Lauf war erfolgreich.'
  1          = 'Das Skript endete mit einem Fehler (Zielordner? .env.local?).'
  2          = 'Datei nicht gefunden.'
  267008     = 'Die Aufgabe wurde noch nie ausgefuehrt.'
  267009     = 'Die Aufgabe laeuft gerade.'
  267010     = 'Die Aufgabe ist noch nicht gelaufen (Ausloeser noch offen).'
  267011     = 'Die Aufgabe wurde noch nie ausgefuehrt.'
  267014     = 'Die Aufgabe wurde abgebrochen.'
  2147942402 = 'Datei nicht gefunden - der Auftrag zeigt auf ein Skript, das es nicht (mehr) gibt.'
  2147942667 = 'Der Startordner im Auftrag stimmt nicht.'
  2147943711 = 'Windows hat den Start verweigert (Rechte).'
}

$gefunden = $false
try {
  $aufgaben = Get-ScheduledTask -ErrorAction Stop |
              Where-Object { $_.TaskName -like '*aukoordination*' -or $_.TaskName -like '*icherung*' }

  foreach ($a in $aufgaben) {
    $gefunden = $true
    $info = $null
    try { $info = $a | Get-ScheduledTaskInfo -ErrorAction Stop } catch { }

    Sag ''
    Sag ('  Name:       ' + $a.TaskName)
    Sag ('  Zustand:    ' + $a.State)

    if ($a.State -eq 'Disabled') {
      [void]$befunde.Add('Der Auftrag ist AUSGESCHALTET. In der Aufgabenplanung Rechtsklick - "Aktivieren".')
    }

    foreach ($aktion in $a.Actions) {
      $ziel = $aktion.Execute
      Sag ('  Startet:    ' + $ziel)
      if ($aktion.WorkingDirectory) { Sag ('  Startordner:' + ' ' + $aktion.WorkingDirectory) }

      if ($ziel) {
        $sauber = $ziel.Trim('"')
        if (-not (Test-Path -LiteralPath $sauber)) {
          Sag '              ^^^ DIESE DATEI GIBT ES NICHT MEHR'
          [void]$befunde.Add('Der Auftrag startet "' + $sauber + '" - diese Datei gibt es nicht. ' +
                             'Das Projekt wurde vermutlich verschoben. Loesung: automatik-einrichten.cmd erneut doppelklicken.')
        }
        elseif ($sauber -ne $skript) {
          Sag ('              ^^^ Hinweis: hier liegt das Skript unter ' + $skript)
          [void]$befunde.Add('Der Auftrag startet ein Skript aus einem anderen Ordner (' + $sauber + '). ' +
                             'Es gibt das Projekt offenbar zweimal. Loesung: automatik-einrichten.cmd hier doppelklicken.')
        }
      }
    }

    foreach ($t in $a.Triggers) {
      $wann = $t.StartBoundary
      if ($wann) { $wann = ($wann -replace 'T', ' ') } else { $wann = '(ohne feste Zeit)' }
      Sag ('  Ausloeser:  ' + $t.CimClass.CimClassName + '  ' + $wann + '  aktiv=' + $t.Enabled)
    }

    if ($info) {
      Sag ('  Zuletzt:    ' + $info.LastRunTime)
      $code = [int64]$info.LastTaskResult
      $text = $bedeutung[[int]$code]
      if (-not $text) { $text = ('unbekannte Rueckmeldung (0x' + ('{0:X}' -f $code) + ')') }
      Sag ('  Ergebnis:   ' + $code + '  = ' + $text)
      Sag ('  Naechster:  ' + $info.NextRunTime)

      if ($code -ne 0 -and $code -ne 267011 -and $code -ne 267008 -and $code -ne 267010) {
        [void]$befunde.Add('Der letzte Lauf endete mit ' + $code + ': ' + $text)
      }
      if (-not $info.NextRunTime) {
        [void]$befunde.Add('Es ist kein naechster Lauf geplant - der Auftrag hat keinen gueltigen Ausloeser mehr.')
      }
    }
  }
}
catch {
  Sag ('  Die Aufgabenplanung liess sich nicht abfragen: ' + $_.Exception.Message)
  Sag '  Ersatzweise ueber schtasks:'
  cmd /c 'schtasks /query /fo list /v' 2>$null |
    Select-String -Pattern 'aukoordination' -Context 0, 12 |
    ForEach-Object { Sag ('  ' + $_) }
}

if (-not $gefunden) {
  Sag '  KEIN Auftrag mit "Baukoordination" im Namen gefunden.'
  [void]$befunde.Add('Es ist gar kein Auftrag eingetragen. Das erklaert alles: ' +
                     'scripts\automatik-einrichten.cmd doppelklicken.')
}

# --- 4) Die Voraussetzungen ------------------------------------------------
Titel 'Voraussetzungen'

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  Sag ('  Node.js:    ' + (& node --version) + '   (' + $node.Source + ')')
} else {
  Sag '  Node.js:    NICHT GEFUNDEN'
  [void]$befunde.Add('Node.js fehlt oder steht nicht im Suchpfad. Neu installieren von https://nodejs.org (LTS).')
}

$env_datei = Join-Path $projekt '.env.local'
if (Test-Path -LiteralPath $env_datei) {
  $inhalt = Get-Content -LiteralPath $env_datei -Raw
  $hatUrl = $inhalt -match 'NEXT_PUBLIC_SUPABASE_URL\s*=\s*\S'
  $hatKey = $inhalt -match 'SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S'
  Sag ('  .env.local: da   (Adresse: ' + $(if ($hatUrl) { 'ja' } else { 'FEHLT' }) +
       ', Schluessel: ' + $(if ($hatKey) { 'ja' } else { 'FEHLT' }) + ')')
  if (-not ($hatUrl -and $hatKey)) {
    [void]$befunde.Add('In .env.local fehlt NEXT_PUBLIC_SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY. ' +
                       'Beide stehen in Vercel unter Settings - Environment Variables.')
  }
} else {
  Sag '  .env.local: FEHLT'
  [void]$befunde.Add('Die Datei .env.local fehlt im Projektordner. Ohne sie kommt das Skript nicht an die Daten.')
}

$bausteine = Join-Path $projekt 'node_modules\@supabase\supabase-js'
if (Test-Path -LiteralPath $bausteine) {
  Sag '  Bausteine:  da'
} else {
  Sag '  Bausteine:  fehlen (npm ci laeuft dann beim naechsten Mal von selbst)'
}

# --- 5) Der Zielordner -----------------------------------------------------
Titel 'Zielordner'

$ziel = $null
if (Test-Path -LiteralPath $skript) {
  $treffer = Select-String -LiteralPath $skript -Pattern '^\s*set\s+"ZIEL=(.+)"\s*$' | Select-Object -First 1
  if ($treffer) { $ziel = $treffer.Matches[0].Groups[1].Value }
}

if (-not $ziel) {
  Sag '  In sicherung-windows.cmd war keine Zeile "set ZIEL=..." zu finden.'
} else {
  Sag ('  Eingetragen: ' + $ziel)
  if (Test-Path -LiteralPath $ziel) {
    Sag '  Vorhanden:   ja'
  } else {
    Sag '  Vorhanden:   NEIN'

    # Den Pfad von hinten kuerzen, bis etwas existiert. Der erste Ordner, den
    # es noch gibt, zeigt genau, ab wo es nicht mehr stimmt - meist ein
    # umbenannter oder neu eingehaengter OneDrive-Ordner.
    $teil = $ziel
    while ($teil -and -not (Test-Path -LiteralPath $teil)) {
      $eltern = Split-Path -LiteralPath $teil -Parent
      if ($eltern -eq $teil) { break }
      $teil = $eltern
    }

    if ($teil -and (Test-Path -LiteralPath $teil)) {
      Sag ''
      Sag ('  Bis hierher stimmt der Pfad: ' + $teil)
      $fehlt = $ziel.Substring([Math]::Min($teil.Length, $ziel.Length)).TrimStart('\')
      Sag ('  Ab hier nicht mehr:          ' + $fehlt)
      Sag ''
      Sag '  In diesem Ordner liegt stattdessen:'
      Get-ChildItem -LiteralPath $teil -Directory -ErrorAction SilentlyContinue |
        Select-Object -First 25 |
        ForEach-Object { Sag ('    ' + $_.Name) }
      [void]$befunde.Add('Der Zielordner stimmt nicht mehr. Bis "' + $teil + '" geht der Pfad auf, ' +
                         'danach nicht. Den richtigen Ordner im Explorer suchen, Pfad oben aus der ' +
                         'Adresszeile kopieren und in scripts\sicherung-windows.cmd in der Zeile ' +
                         'set "ZIEL=..." einsetzen.')
    } else {
      [void]$befunde.Add('Der Zielordner "' + $ziel + '" existiert nicht, und auch keiner seiner Oberordner.')
    }
  }
}

# --- 6) Was liegt da? ------------------------------------------------------
Titel 'Vorhandene Sicherungen'

if ($ziel -and (Test-Path -LiteralPath $ziel)) {
  $ordner = Get-ChildItem -LiteralPath $ziel -Directory -Filter 'Baukoordination-*' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
  if ($ordner) {
    foreach ($o in ($ordner | Select-Object -First 8)) {
      $groesse = 0
      try {
        $groesse = (Get-ChildItem -LiteralPath $o.FullName -Recurse -File -ErrorAction SilentlyContinue |
                    Measure-Object -Property Length -Sum).Sum
      } catch { }
      Sag ('  ' + $o.Name + '   ' + $o.LastWriteTime.ToString('dd.MM.yyyy HH:mm') +
           '   ' + [Math]::Round($groesse / 1MB, 1) + ' MB')
    }
    Sag ('  (insgesamt ' + $ordner.Count + ')')

    $neuste = $ordner[0].LastWriteTime
    $tage = [Math]::Floor(((Get-Date) - $neuste).TotalDays)
    Sag ''
    Sag ('  Neuste Sicherung ist ' + $tage + ' Tag(e) alt.')
    if ($tage -ge 2) {
      [void]$befunde.Add('Die neuste Sicherung ist ' + $tage + ' Tage alt.')
    }
  } else {
    Sag '  Keine einzige Sicherung in diesem Ordner.'
    [void]$befunde.Add('Im Zielordner liegt keine einzige Sicherung - es hat noch nie funktioniert, ' +
                       'oder es wurde woanders hingeschrieben.')
  }
}

# Der haeufigste Irrtum: ohne --ziel schreibt das Skript in den Projektordner.
$daneben = Join-Path $projekt 'sicherung'
if (Test-Path -LiteralPath $daneben) {
  Sag ''
  Sag ('  ACHTUNG: Es gibt auch einen Ordner ' + $daneben)
  Get-ChildItem -LiteralPath $daneben -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 5 |
    ForEach-Object { Sag ('    ' + $_.Name) }
  [void]$befunde.Add('Es liegen Sicherungen im Projektordner unter "sicherung". ' +
                     'Dann lief das Skript ohne --ziel und OneDrive bekommt nichts davon mit.')
}

# --- 7) Das Protokoll ------------------------------------------------------
Titel 'Protokoll des letzten Laufs'

if (Test-Path -LiteralPath $protokoll) {
  Get-Content -LiteralPath $protokoll -Tail 40 | ForEach-Object { Sag ('  ' + $_) }
} else {
  Sag '  Noch kein Protokoll vorhanden.'
  Sag '  (Ab der naechsten Fassung schreibt jede Sicherung hier mit.)'
}

# --- Befund ----------------------------------------------------------------
Sag ''
Sag '==========================================================='
if ($befunde.Count -eq 0) {
  Sag '  Es ist nichts Auffaelliges zu finden.'
  Sag '  Bitte trotzdem die Textdatei schicken - sie zeigt mehr als'
  Sag '  diese Zusammenfassung.'
} else {
  Sag '  GEFUNDEN:'
  $n = 1
  foreach ($b in $befunde) {
    Sag ''
    Sag ('  ' + $n + '. ' + $b)
    $n++
  }
}
Sag '==========================================================='

$datei = Join-Path $PSScriptRoot 'pruefung-sicherung.txt'
try {
  $zeilen | Out-File -LiteralPath $datei -Encoding UTF8
  Sag ''
  Sag ('Alles steht auch hier: ' + $datei)
  Sag 'Diese Datei kannst du mir schicken.'
} catch {
  Sag ''
  Sag ('Die Textdatei liess sich nicht schreiben: ' + $_.Exception.Message)
}
