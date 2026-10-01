# ===========================================================================
#  Baukoordination – Sicherung reparieren und auf der Stelle beweisen
#
#  Ein Doppelklick, der vier Dinge der Reihe nach tut:
#
#    1. Zeigt, was gerade eingetragen ist
#    2. Raeumt alle alten Auftraege weg und traegt einen sauberen ein
#    3. Startet GENAU DIESEN Auftrag und wartet, bis er fertig ist
#    4. Sieht nach, ob im Zielordner wirklich eine Sicherung von heute liegt
#
#  Punkt 3 ist der Kern. Ein Doppelklick auf sicherung-windows.cmd beweist
#  naemlich wenig: Dabei sitzt jemand davor, das Fenster ist offen, der
#  Arbeitsordner stimmt. Die Aufgabenplanung startet dasselbe Skript ohne all
#  das – und genau dort lag der Fehler. Deshalb wird hier der Auftrag selbst
#  ausgeloest, mit allem, was dazugehoert, und hinterher steht die
#  Rueckmeldung von Windows im Klartext da.
#
#  Aufgerufen ueber sicherung-reparieren.cmd (doppelklicken).
# ===========================================================================

$ErrorActionPreference = 'Continue'

$name = 'Baukoordination Sicherung'
$skript = Join-Path $PSScriptRoot 'sicherung-windows.cmd'

function Abschnitt($text) {
  Write-Host ''
  Write-Host ('--- ' + $text + ' ' + ('-' * [Math]::Max(0, 66 - $text.Length)))
  Write-Host ''
}

Write-Host ''
Write-Host '==========================================================='
Write-Host '  Baukoordination - Sicherung reparieren'
Write-Host '==========================================================='

# --- 1) Was ist jetzt da? --------------------------------------------------
Abschnitt 'Vorher'

$vorher = Get-ScheduledTask -ErrorAction SilentlyContinue |
          Where-Object { $_.TaskName -like 'Baukoordination*' }

if (-not $vorher) {
  Write-Host '  Kein Auftrag eingetragen.'
} else {
  foreach ($a in $vorher) {
    $i = $a | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
    $roh = if ($i) { [int64]$i.LastTaskResult } else { 0 }
    if ($roh -lt 0) { $roh += 4294967296 }
    Write-Host ('  ' + $a.TaskName + '   Zustand: ' + $a.State +
                '   letztes Ergebnis: ' + ('0x{0:X8}' -f $roh))
  }
}

# --- 2) Neu eintragen ------------------------------------------------------
Abschnitt 'Neu eintragen'

& (Join-Path $PSScriptRoot 'automatik-einrichten.ps1')

$auftrag = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if (-not $auftrag) {
  Write-Host ''
  Write-Host '  FEHLER: Der Auftrag konnte nicht eingetragen werden.'
  Write-Host '  Den Text oben bitte schicken.'
  return
}

# --- 3) Den Auftrag selbst ausloesen ---------------------------------------
Abschnitt 'Probelauf - der Auftrag wird jetzt gestartet'

Write-Host '  Gestartet. Das dauert je nach Datenmenge ein bis fuenf Minuten.'
Write-Host '  Bitte dieses Fenster offen lassen.'
Write-Host ''

try {
  Start-ScheduledTask -TaskName $name -ErrorAction Stop
} catch {
  Write-Host ('  FEHLER beim Starten: ' + $_.Exception.Message)
  return
}

# Warten, bis die Aufgabe nicht mehr laeuft. Mit Obergrenze: Haengt sie doch
# wieder, soll dieses Fenster nicht mit ihr zusammen stehenbleiben.
$grenze = (Get-Date).AddMinutes(12)
$lief = $false

while ((Get-Date) -lt $grenze) {
  Start-Sleep -Seconds 3
  $jetzt = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if (-not $jetzt) { break }

  if ($jetzt.State -eq 'Running') {
    if (-not $lief) {
      Write-Host '  Laeuft...'
      $lief = $true
    }
    continue
  }

  if ($lief) { break }
}

$info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue
$roh = if ($info) { [int64]$info.LastTaskResult } else { -1 }
if ($roh -lt 0 -and $roh -ne -1) { $roh += 4294967296 }
$hex = ('0x{0:X8}' -f $roh)

Write-Host ''
Write-Host ('  Rueckmeldung von Windows: ' + $hex)

switch ($hex) {
  '0x00000000' { Write-Host '  = Der Lauf ist sauber durchgelaufen.' }
  '0x0000000A' { Write-Host '  = Node.js wurde nicht gefunden.' }
  '0x0000000B' { Write-Host '  = Die Datei .env.local fehlt im Projektordner.' }
  '0x0000000C' { Write-Host '  = npm ci ist fehlgeschlagen.' }
  '0x0000000D' { Write-Host '  = Der ZIELORDNER wurde nicht gefunden. Siehe unten.' }
  '0x00000001' { Write-Host '  = Das Sicherungsskript endete mit einem Fehler. Siehe Protokoll unten.' }
  '0xC000013A' { Write-Host '  = Der Lauf wurde abgebrochen - das Skript wartete auf einen Tastendruck.' }
  '0x00041301' { Write-Host '  = Laeuft noch. Spaeter mit sicherung-pruefen.cmd nachsehen.' }
  default      { Write-Host '  = Unerwartete Rueckmeldung.' }
}

# --- 4) Liegt wirklich etwas da? -------------------------------------------
Abschnitt 'Ergebnis im Zielordner'

$ziel = $null
if (Test-Path -LiteralPath $skript) {
  $treffer = Select-String -LiteralPath $skript -Pattern '^\s*set\s+"ZIEL=(.+)"\s*$' | Select-Object -First 1
  if ($treffer) { $ziel = $treffer.Matches[0].Groups[1].Value }
}

$heute = (Get-Date).ToString('yyyy-MM-dd')
$erfolg = $false

if (-not $ziel) {
  Write-Host '  In sicherung-windows.cmd war keine Zeile "set ZIEL=..." zu finden.'
} elseif (-not (Test-Path -LiteralPath $ziel)) {
  Write-Host ('  Der Zielordner existiert nicht: ' + $ziel)
  Write-Host '  Bitte sicherung-pruefen.cmd doppelklicken - es zeigt, ab welcher'
  Write-Host '  Stelle der Pfad nicht mehr stimmt.'
} else {
  $ordner = Join-Path $ziel ('Baukoordination-' + $heute)
  if (Test-Path -LiteralPath $ordner) {
    $anzahl = (Get-ChildItem -LiteralPath $ordner -Recurse -File -ErrorAction SilentlyContinue |
               Measure-Object).Count
    Write-Host ('  Da: ' + $ordner)
    Write-Host ('      ' + $anzahl + ' Dateien')
    $erfolg = $true
  } else {
    Write-Host ('  Fuer heute liegt nichts da: ' + $ordner)
    Write-Host ''
    Write-Host '  Vorhanden sind:'
    Get-ChildItem -LiteralPath $ziel -Directory -Filter 'Baukoordination-*' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 5 |
      ForEach-Object { Write-Host ('    ' + $_.Name) }
  }
}

# --- Das Protokoll des Laufs -----------------------------------------------
$protokoll = Join-Path $PSScriptRoot 'sicherung.log'
if (Test-Path -LiteralPath $protokoll) {
  Abschnitt 'Was das Skript dabei gesagt hat'
  Get-Content -LiteralPath $protokoll -Tail 25 | ForEach-Object { Write-Host ('  ' + $_) }
}

# --- Urteil ----------------------------------------------------------------
Write-Host ''
Write-Host '==========================================================='
if ($erfolg -and $hex -eq '0x00000000') {
  Write-Host '  ES LAEUFT.'
  Write-Host ''
  Write-Host '  Gesichert wird ab jetzt taeglich um 10:00, nochmals um 13:00,'
  Write-Host '  falls der Rechner um 10:00 aus war, und beim naechsten'
  Write-Host '  Hochfahren, falls beides verpasst wurde.'
  Write-Host ''
  Write-Host '  Der Rechner muss dafuer laufen und angemeldet sein. Die App'
  Write-Host '  muss NICHT offen sein.'
} else {
  Write-Host '  NOCH NICHT. Bitte sicherung-pruefen.cmd doppelklicken und mir'
  Write-Host '  die Datei pruefung-sicherung.txt schicken - darin steht alles,'
  Write-Host '  was hier fehlt.'
}
Write-Host '==========================================================='
Write-Host ''
