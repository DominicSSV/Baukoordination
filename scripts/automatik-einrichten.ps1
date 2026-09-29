# ===========================================================================
#  Baukoordination – taegliche Sicherung automatisch einrichten (Windows)
#
#  Traegt einen Auftrag mit mehreren Ausloesern in die Aufgabenplanung ein:
#
#    1. Taeglich um 10:00
#    2. Taeglich um 13:00
#    3. Bei jeder Anmeldung, zwei Minuten verzoegert
#
#  Mehrere und nicht einer, weil das die Frage beantwortet, die bei einem
#  festen Termin offen bleibt: Was, wenn der Rechner um 10:00 aus war? Dann
#  greift 13:00, und sonst die naechste Anmeldung. Dazu kommt
#  "StartWhenAvailable" – Windows holt einen verpassten Termin von sich aus
#  nach.
#
#  Gesichert wird deswegen trotzdem nur einmal am Tag: Das Sicherungsskript
#  prueft, ob heute schon eine Sicherung entstanden ist, und endet dann
#  sofort. Die weiteren Termine sind Auffangnetze, keine zweite Sicherung.
#
#  Frueher entstand dieser Auftrag aus einer XML-Datei, die per "echo" in den
#  Temp-Ordner geschrieben wurde. Die trug im Kopf "UTF-16", war aber in
#  Wahrheit ANSI – schtasks lehnt das je nach Windows-Fassung wortlos ab.
#  Hier wird der Auftrag direkt gebaut; eine Datei dazwischen gibt es nicht
#  mehr.
#
#  Aufgerufen ueber automatik-einrichten.cmd (doppelklicken).
#  Verwaltungsrechte braucht es nicht.
# ===========================================================================

$ErrorActionPreference = 'Stop'

$projekt = Split-Path -Parent $PSScriptRoot
$skript  = Join-Path $PSScriptRoot 'sicherung-windows.cmd'
$name    = 'Baukoordination Sicherung'

Write-Host ''
Write-Host '==========================================================='
Write-Host '  Taegliche Sicherung einrichten'
Write-Host '==========================================================='
Write-Host ''
Write-Host ('  Skript:  ' + $skript)
Write-Host ('  Starten: ' + $projekt)
Write-Host ''

if (-not (Test-Path -LiteralPath $skript)) {
  Write-Host '  FEHLER: sicherung-windows.cmd nicht gefunden.'
  Write-Host '  Liegt diese Datei im Ordner "scripts" des Projekts?'
  Write-Host ''
  return
}

try {
  # --- Alte Auftraege wegraeumen --------------------------------------------
  #
  # Es sammelten sich mehrere an: einer aus einem frueheren Einrichten, einer
  # von Hand angelegt. Sie feuerten zur selben Zeit, und weil immer nur eine
  # Ausfuehrung zugelassen ist, wies Windows die zweite ab
  # ("0x800710E0") – im Verlauf sah das aus wie ein Fehler der Sicherung.
  # Ein Auftrag genuegt.
  $alte = Get-ScheduledTask -ErrorAction SilentlyContinue |
          Where-Object { $_.TaskName -like 'Baukoordination*' }

  foreach ($a in $alte) {
    Write-Host ('  Alter Auftrag entfernt: ' + $a.TaskName)
    Unregister-ScheduledTask -TaskName $a.TaskName -Confirm:$false -ErrorAction SilentlyContinue
  }

  # Das Kennwort "/automatik" sagt dem Skript, dass niemand davorsitzt.
  #
  # Ohne diesen Hinweis kann es das nicht wissen: Die Aufgabenplanung startet
  # eine .cmd-Datei genauso ueber "cmd /c" wie ein Doppelklick. Das Skript
  # hielt deshalb auch im Auftrag am Ende mit "Weiter mit beliebiger Taste"
  # an – und blieb dort stehen, bis Windows es abbrach ("0xC000013A").
  $aktion = New-ScheduledTaskAction -Execute $skript -Argument '/automatik' -WorkingDirectory $projekt

  $morgens = New-ScheduledTaskTrigger -Daily -At '10:00'
  $mittags = New-ScheduledTaskTrigger -Daily -At '13:00'

  # Zwei Minuten Verzoegerung: Direkt nach dem Hochfahren ist oft noch kein
  # Netz da, und ohne Netz kommt das Skript nicht an die Daten.
  $anmeldung = New-ScheduledTaskTrigger -AtLogOn
  $anmeldung.Delay = 'PT2M'

  $einstellungen = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RunOnlyIfNetworkAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

  # Nur wenn angemeldet – so braucht es kein gespeichertes Passwort und keine
  # Verwaltungsrechte. Um acht Uhr morgens ist der Rechner ohnehin offen.
  $ich = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $prinzipal = New-ScheduledTaskPrincipal -UserId $ich -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $name `
    -Action $aktion `
    -Trigger $morgens, $mittags, $anmeldung `
    -Settings $einstellungen `
    -Principal $prinzipal `
    -Description 'Sichert die Baukoordination taeglich in den OneDrive-Ordner.' `
    -Force | Out-Null
}
catch {
  Write-Host ''
  Write-Host '  FEHLER: Der Auftrag konnte nicht eingetragen werden.'
  Write-Host ('  ' + $_.Exception.Message)
  Write-Host ''
  Write-Host '  Bitte diesen Text schicken.'
  Write-Host ''
  return
}

$info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '==========================================================='
Write-Host '  Eingerichtet.'
Write-Host ''
Write-Host '  Gesichert wird ab jetzt:'
Write-Host '    - taeglich um 10:00'
Write-Host '    - nochmals um 13:00, falls 10:00 nicht geklappt hat'
Write-Host '    - beim naechsten Hochfahren, falls beides verpasst wurde'
Write-Host '    - hoechstens einmal pro Tag'
if ($info -and $info.NextRunTime) {
  Write-Host ''
  Write-Host ('  Naechster Lauf: ' + $info.NextRunTime)
}
Write-Host ''
Write-Host '  Nachsehen: Windows-Taste - "Aufgabenplanung" -'
Write-Host '  "Aufgabenplanungsbibliothek" - "Baukoordination Sicherung"'
Write-Host ''
Write-Host '  Jetzt gleich ausprobieren? Dort Rechtsklick - "Ausfuehren".'
Write-Host '  Geht etwas schief: sicherung-pruefen.cmd doppelklicken.'
Write-Host '==========================================================='
Write-Host ''
