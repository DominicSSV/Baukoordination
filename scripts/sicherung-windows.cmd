@echo off
rem ===========================================================================
rem  Baukoordination – taegliche Sicherung (Windows)
rem
rem  Schreibt die Sicherung in den OneDrive-Ordner. Hochgeladen wird sie von
rem  OneDrive selbst – dieses Skript kennt die Cloud gar nicht. Deshalb
rem  funktioniert es mit OneDrive, SharePoint, Dropbox und kDrive gleich gut,
rem  und es liegen nirgends Cloud-Zugangsdaten herum.
rem
rem  Jeder Lauf schreibt mit: scripts\sicherung.log. Ueber die Aufgabenplanung
rem  laeuft das hier unsichtbar – kein Fenster, und scheitert es, schliesst
rem  sich alles wortlos. Ohne Protokoll stuende man Tage spaeter vor einem
rem  leeren Sicherungsordner und haette nichts, woran man sehen koennte, warum.
rem
rem  Zum Ausprobieren: doppelklicken. Das Fenster bleibt am Ende offen.
rem  Geht etwas schief: scripts\sicherung-pruefen.cmd doppelklicken.
rem ===========================================================================

setlocal

rem --- Wohin gesichert wird --------------------------------------------------
rem  Anpassen, falls der Ordner umzieht. Anfuehrungszeichen gehoeren NICHT in
rem  die Zeile – der Pfad enthaelt Leerzeichen, darum steht er unten in
rem  Anfuehrungszeichen, wenn er benutzt wird.
set "ZIEL=C:\Users\DominicMaag\Swiss Property Management AG\Liegenschaften - Dokumente\Swiss Solar Ventures AG\7. Baukoordination\2. Backup"

set "LOG=%~dp0sicherung.log"
set "AUSGABE=%TEMP%\baukoordination-lauf.txt"
set "FEHLER=0"

rem  Doppelklick oder Aufgabenplanung? Beim Doppelklick soll man zusehen
rem  koennen, wie die Sicherung laeuft; die Aufgabenplanung schaut niemandem
rem  zu und bekommt dafuer alles ins Protokoll.
set "INTERAKTIV="
echo %cmdcmdline% | find /i "/c" >nul
if not errorlevel 1 set "INTERAKTIV=1"

rem --- In den Projektordner wechseln -----------------------------------------
rem  %~dp0 ist der Ordner dieser Datei, also ...\Baukoordination\scripts\.
rem  Ein Verzeichnis darueber liegt das Projekt. So laeuft das Skript
rem  unabhaengig davon, wo es gestartet wurde – die Aufgabenplanung startet
rem  sonst im Windows-Systemordner.
cd /d "%~dp0.."

call :sag ""
call :sag "==========================================================="
call :sag "Lauf am %date% um %time%"
call :sag "Projektordner: %cd%"

rem --- Nachsehen, ob alles bereit ist ----------------------------------------
where node >nul 2>nul
if errorlevel 1 goto keinnode

if not exist ".env.local" goto keinumgebung

if not exist "node_modules\@supabase\supabase-js" (
  call :sag "Die benoetigten Bausteine fehlen noch. Das dauert einmalig ein paar Minuten..."
  call npm ci
  if errorlevel 1 goto keinnpm
)

rem --- Zielordner pruefen ----------------------------------------------------
rem  Das Skript wuerde ihn selbst anlegen. Genau das ist hier aber gefaehrlich:
rem  Ist der OneDrive-Pfad falsch geschrieben, entstuende stillschweigend ein
rem  zweiter Ordner irgendwo, und die Sicherung laege monatelang am falschen
rem  Ort, ohne je in die Cloud zu kommen.
if not exist "%ZIEL%" goto keinziel

rem --- Sichern ---------------------------------------------------------------
call :sag "Sicherung nach: %ZIEL%"

if defined INTERAKTIV goto zusehen

rem  Unsichtbarer Lauf: alles einsammeln, damit es hinterher nachlesbar ist.
node scripts\sicherung.mjs --ziel "%ZIEL%" > "%AUSGABE%" 2>&1
set FEHLER=%errorlevel%
type "%AUSGABE%" >> "%LOG%"
del "%AUSGABE%" >nul 2>nul
goto ergebnis

:zusehen
rem  Live zusehen – am Bildschirm, das Ergebnis danach ins Protokoll.
node scripts\sicherung.mjs --ziel "%ZIEL%"
set FEHLER=%errorlevel%

:ergebnis
if "%FEHLER%"=="0" goto gut
call :sag "================================================================"
call :sag " ACHTUNG: Die Sicherung ist NICHT vollstaendig durchgelaufen."
call :sag " Rueckmeldung: %FEHLER%"
call :sag " Nachsehen mit scripts\sicherung-pruefen.cmd"
call :sag "================================================================"
goto ende

:gut
call :sag "Fertig. OneDrive laedt den Ordner jetzt von selbst hoch."
goto ende

:keinnode
call :sag "FEHLER: Node.js ist nicht installiert oder nicht auffindbar."
call :sag "        Herunterladen: https://nodejs.org - die LTS-Fassung."
set FEHLER=10
goto ende

:keinumgebung
call :sag "FEHLER: Die Datei .env.local fehlt im Projektordner."
call :sag "        Darin muessen stehen:"
call :sag "          NEXT_PUBLIC_SUPABASE_URL=..."
call :sag "          SUPABASE_SERVICE_ROLE_KEY=..."
call :sag "        Beide stehen in Vercel unter Settings - Environment Variables."
set FEHLER=11
goto ende

:keinnpm
call :sag "FEHLER: npm ci ist fehlgeschlagen."
set FEHLER=12
goto ende

:keinziel
call :sag "FEHLER: Der Zielordner existiert nicht:"
call :sag "  %ZIEL%"
call :sag "  Bitte scripts\sicherung-pruefen.cmd doppelklicken - es zeigt,"
call :sag "  ab welcher Stelle der Pfad nicht mehr stimmt."
set FEHLER=13
goto ende

:ende

rem  Das Protokoll darf nicht ewig wachsen: Was aelter ist als die letzten
rem  paar hundert Zeilen, hat noch nie jemandem geholfen.
if exist "%LOG%" powershell -NoProfile -Command "if ((Get-Item -LiteralPath $env:LOG).Length -gt 400kb) { $t = Get-Content -LiteralPath $env:LOG -Tail 300; Set-Content -LiteralPath $env:LOG -Value $t }" >nul 2>nul

rem  Nur anhalten, wenn jemand doppelgeklickt hat. Laeuft das Skript ueber die
rem  Aufgabenplanung, wuerde ein "pause" es fuer immer stehen lassen.
if defined INTERAKTIV pause

endlocal & exit /b %FEHLER%

rem --- Einmal sagen, zweimal aufschreiben ------------------------------------
:sag
if "%~1"=="" goto sagleer
echo %~1
>>"%LOG%" echo %~1
goto :eof
:sagleer
echo.
>>"%LOG%" echo.
goto :eof
