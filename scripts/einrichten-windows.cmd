@echo off
rem ===========================================================================
rem  Baukoordination – Einrichtung (Windows), einmalig
rem
rem  Fragt die beiden Schluessel ab, legt die Datei .env.local an, laedt die
rem  benoetigten Bausteine und macht gleich die erste Sicherung.
rem
rem  Warum es diese Datei gibt: Die .env.local von Hand anzulegen ist der
rem  einzige wirklich fehleranfaellige Schritt. Windows blendet Dateiendungen
rem  aus, und der Editor haengt beim Speichern stillschweigend ".txt" an –
rem  danach sucht man eine halbe Stunde, warum nichts geht.
rem
rem  Doppelklicken. Sonst nichts.
rem ===========================================================================

setlocal enabledelayedexpansion
chcp 65001 >nul 2>nul

cd /d "%~dp0.."

echo.
echo ===========================================================
echo   Baukoordination - Einrichtung der taeglichen Sicherung
echo ===========================================================
echo.

rem --- 1) Node vorhanden? ----------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js ist noch nicht installiert.
  echo.
  echo   1. https://nodejs.org oeffnen
  echo   2. Den grossen gruenen Knopf mit "LTS" anklicken
  echo   3. Die heruntergeladene Datei ausfuehren, alles auf Standard lassen
  echo   4. Den Rechner neu starten
  echo   5. Diese Datei hier nochmals doppelklicken
  echo.
  goto ende
)

for /f "tokens=*" %%v in ('node --version') do set NODEV=%%v
echo   Node.js gefunden: !NODEV!
echo.

rem --- 2) Schluessel ---------------------------------------------------------
if exist ".env.local" (
  echo   Die Datei .env.local gibt es schon - die Schluessel bleiben, wie sie sind.
  echo   Sollen sie neu eingegeben werden, diese Datei loeschen und nochmals starten.
  echo.
  goto bausteine
)

echo   Jetzt brauche ich zwei Angaben aus Vercel.
echo.
echo   So kommst du hin:
echo     vercel.com oeffnen - dein Projekt anklicken - oben "Settings"
echo     - links "Environment Variables"
echo.
echo   Dort stehen die beiden Werte. Auf das Auge klicken, um sie zu sehen,
echo   dann markieren und kopieren.
echo.

:frageUrl
set "SUPA_URL="
set /p "SUPA_URL=  NEXT_PUBLIC_SUPABASE_URL (beginnt mit https://): "
if "!SUPA_URL!"=="" goto frageUrl

:frageKey
set "SUPA_KEY="
set /p "SUPA_KEY=  SUPABASE_SERVICE_ROLE_KEY (langer Text): "
if "!SUPA_KEY!"=="" goto frageKey

rem  Ohne Leerzeichen vor dem Umleitungszeichen: sonst landet es in der Datei.
>".env.local" echo NEXT_PUBLIC_SUPABASE_URL=!SUPA_URL!
>>".env.local" echo SUPABASE_SERVICE_ROLE_KEY=!SUPA_KEY!

echo.
echo   Gespeichert in .env.local
echo.
echo   WICHTIG: Diese Datei ist der Schluessel zu allen Daten. Sie gehoert
echo            NICHT in OneDrive und in keine Mail.
echo.

:bausteine
rem --- 3) Bausteine ----------------------------------------------------------
if not exist "node_modules\@supabase\supabase-js" (
  echo   Die benoetigten Bausteine werden geladen. Das dauert ein paar Minuten...
  echo.
  call npm ci
  if errorlevel 1 (
    echo.
    echo   FEHLER: Das Laden ist fehlgeschlagen. Besteht eine Internetverbindung?
    echo.
    goto ende
  )
  echo.
)

rem --- 4) Erste Sicherung ----------------------------------------------------
echo   Jetzt die erste Sicherung. Das kann je nach Anzahl Fotos dauern.
echo.
call "%~dp0sicherung-windows.cmd"

echo.
echo ===========================================================
echo   Geschafft.
echo.
echo   Damit es taeglich von selbst laeuft, fehlt noch die
echo   Aufgabenplanung - die Schritte stehen in
echo   scripts\SICHERUNG.md unter "Taeglich automatisch".
echo ===========================================================
echo.

:ende
pause
endlocal
