@echo off
rem ===========================================================================
rem  Baukoordination – taegliche Sicherung (Windows)
rem
rem  Schreibt die Sicherung in den OneDrive-Ordner. Hochgeladen wird sie von
rem  OneDrive selbst – dieses Skript kennt die Cloud gar nicht. Deshalb
rem  funktioniert es mit OneDrive, SharePoint, Dropbox und kDrive gleich gut,
rem  und es liegen nirgends Cloud-Zugangsdaten herum.
rem
rem  Zum Ausprobieren: doppelklicken. Das Fenster bleibt am Ende offen, damit
rem  man sieht, was passiert ist.
rem
rem  Taeglich automatisch: siehe scripts\SICHERUNG.md, Abschnitt "Windows".
rem ===========================================================================

setlocal

rem --- Wohin gesichert wird --------------------------------------------------
rem  Anpassen, falls der Ordner umzieht. Anfuehrungszeichen gehoeren NICHT in
rem  die Zeile – der Pfad enthaelt Leerzeichen, darum steht er unten in
rem  Anfuehrungszeichen, wenn er benutzt wird.
set "ZIEL=C:\Users\DominicMaag\Swiss Property Management AG\Liegenschaften - Dokumente\Swiss Solar Ventures AG\7. Baukoordination\2. Backup"

rem --- In den Projektordner wechseln -----------------------------------------
rem  %~dp0 ist der Ordner dieser Datei, also ...\Baukoordination\scripts\.
rem  Ein Verzeichnis darueber liegt das Projekt. So laeuft das Skript
rem  unabhaengig davon, wo es gestartet wurde – die Aufgabenplanung startet
rem  sonst im Windows-Systemordner.
cd /d "%~dp0.."

rem --- Nachsehen, ob alles bereit ist ----------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo FEHLER: Node.js ist nicht installiert oder nicht auffindbar.
  echo         Herunterladen: https://nodejs.org  ^(die LTS-Fassung^)
  echo.
  goto ende
)

if not exist ".env.local" (
  echo.
  echo FEHLER: Die Datei .env.local fehlt im Projektordner.
  echo         Darin muessen stehen:
  echo           NEXT_PUBLIC_SUPABASE_URL=...
  echo           SUPABASE_SERVICE_ROLE_KEY=...
  echo         Beide findest du in Vercel unter Settings - Environment Variables.
  echo.
  goto ende
)

if not exist "node_modules\@supabase\supabase-js" (
  echo Die benoetigten Bausteine fehlen noch. Das dauert einmalig ein paar Minuten...
  call npm ci
  if errorlevel 1 (
    echo.
    echo FEHLER: npm ci ist fehlgeschlagen.
    echo.
    goto ende
  )
)

rem --- Zielordner pruefen ----------------------------------------------------
rem  Das Skript wuerde ihn selbst anlegen. Genau das ist hier aber gefaehrlich:
rem  Ist der OneDrive-Pfad falsch geschrieben, entstuende stillschweigend ein
rem  zweiter Ordner irgendwo, und die Sicherung laege monatelang am falschen
rem  Ort, ohne je in die Cloud zu kommen.
if not exist "%ZIEL%" (
  echo.
  echo FEHLER: Der Zielordner existiert nicht:
  echo   %ZIEL%
  echo.
  echo   Bitte im Explorer nachsehen, ob der Pfad stimmt, und ihn
  echo   gegebenenfalls oben in dieser Datei anpassen ^(Zeile mit "set ZIEL"^).
  echo.
  set FEHLER=1
  goto ende
)

rem --- Sichern ---------------------------------------------------------------
echo.
echo Sicherung nach:
echo   %ZIEL%
echo.

node scripts\sicherung.mjs --ziel "%ZIEL%"
set FEHLER=%errorlevel%

echo.
if %FEHLER% neq 0 (
  echo ================================================================
  echo  ACHTUNG: Die Sicherung ist NICHT vollstaendig durchgelaufen.
  echo  Bitte die Meldungen oben lesen.
  echo ================================================================
) else (
  echo Fertig. OneDrive laedt den Ordner jetzt von selbst hoch.
)

:ende
rem  Nur anhalten, wenn jemand doppelgeklickt hat. Laeuft das Skript ueber die
rem  Aufgabenplanung, wuerde ein "pause" es fuer immer stehen lassen.
echo %cmdcmdline% | find /i "/c" >nul
if not errorlevel 1 pause

endlocal
exit /b %FEHLER%
