@echo off
rem ===========================================================================
rem  Baukoordination – taegliche Sicherung automatisch einrichten (Windows)
rem
rem  Traegt zwei Auftraege in die Windows-Aufgabenplanung ein:
rem
rem    1. Taeglich um 19:00
rem    2. Bei jeder Anmeldung, zwei Minuten verzoegert
rem
rem  Zwei Auftraege und nicht einer, weil das genau die Frage beantwortet, die
rem  bei einem festen Termin offen bleibt: Was, wenn der Rechner um 19:00 aus
rem  war? Dann greift der zweite beim naechsten Einschalten.
rem
rem  Doppelt gesichert wird deswegen nicht: Das Sicherungsskript prueft, ob
rem  heute schon gesichert wurde, und endet dann sofort. Wer den Rechner
rem  dreimal am Tag hochfaehrt, bekommt eine Sicherung und nicht drei.
rem
rem  Die zwei Minuten Verzoegerung sind noetig, weil direkt nach dem Hochfahren
rem  oft noch kein Netz da ist.
rem
rem  Doppelklicken. Verwaltungsrechte braucht es nicht – die Auftraege laufen
rem  unter dem angemeldeten Benutzer.
rem ===========================================================================

setlocal enabledelayedexpansion

set "PROJEKT=%~dp0.."
set "SKRIPT=%~dp0sicherung-windows.cmd"
set "XML=%TEMP%\baukoordination-aufgabe.xml"

echo.
echo ===========================================================
echo   Taegliche Sicherung einrichten
echo ===========================================================
echo.
echo   Skript:  %SKRIPT%
echo   Starten: %PROJEKT%
echo.

if not exist "%SKRIPT%" (
  echo   FEHLER: sicherung-windows.cmd nicht gefunden.
  echo   Liegt diese Datei im Ordner "scripts" des Projekts?
  echo.
  goto ende
)

rem --- Aufgabenbeschreibung schreiben ----------------------------------------
rem  Ueber eine XML-Datei und nicht ueber schtasks-Schalter: Nur so lassen sich
rem  zwei Ausloeser, das Nachholen nach einem verpassten Start und die
rem  Netzwerkbedingung in einem Auftrag zusammenfassen.
rem
rem  Bewusst ohne Umlaute: schtasks ist bei der Zeichenkodierung heikel.
(
echo ^<?xml version="1.0" encoding="UTF-16"?^>
echo ^<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"^>
echo   ^<RegistrationInfo^>
echo     ^<Description^>Sichert die Baukoordination taeglich in den OneDrive-Ordner.^</Description^>
echo   ^</RegistrationInfo^>
echo   ^<Triggers^>
echo     ^<CalendarTrigger^>
echo       ^<StartBoundary^>2026-01-01T19:00:00^</StartBoundary^>
echo       ^<Enabled^>true^</Enabled^>
echo       ^<ScheduleByDay^>^<DaysInterval^>1^</DaysInterval^>^</ScheduleByDay^>
echo     ^</CalendarTrigger^>
echo     ^<LogonTrigger^>
echo       ^<Enabled^>true^</Enabled^>
echo       ^<Delay^>PT2M^</Delay^>
echo     ^</LogonTrigger^>
echo   ^</Triggers^>
echo   ^<Principals^>
echo     ^<Principal id="Author"^>
echo       ^<LogonType^>InteractiveToken^</LogonType^>
echo       ^<RunLevel^>LeastPrivilege^</RunLevel^>
echo     ^</Principal^>
echo   ^</Principals^>
echo   ^<Settings^>
echo     ^<MultipleInstancesPolicy^>IgnoreNew^</MultipleInstancesPolicy^>
echo     ^<DisallowStartIfOnBatteries^>false^</DisallowStartIfOnBatteries^>
echo     ^<StopIfGoingOnBatteries^>false^</StopIfGoingOnBatteries^>
echo     ^<StartWhenAvailable^>true^</StartWhenAvailable^>
echo     ^<RunOnlyIfNetworkAvailable^>true^</RunOnlyIfNetworkAvailable^>
echo     ^<Enabled^>true^</Enabled^>
echo     ^<Hidden^>false^</Hidden^>
echo     ^<ExecutionTimeLimit^>PT2H^</ExecutionTimeLimit^>
echo     ^<Priority^>7^</Priority^>
echo   ^</Settings^>
echo   ^<Actions Context="Author"^>
echo     ^<Exec^>
echo       ^<Command^>%SKRIPT%^</Command^>
echo       ^<WorkingDirectory^>%PROJEKT%^</WorkingDirectory^>
echo     ^</Exec^>
echo   ^</Actions^>
echo ^</Task^>
) > "%XML%"

rem --- Eintragen -------------------------------------------------------------
schtasks /create /tn "Baukoordination Sicherung" /xml "%XML%" /f
if errorlevel 1 (
  echo.
  echo   FEHLER: Der Auftrag konnte nicht eingetragen werden.
  echo   Bitte den Text oben lesen und mir schicken.
  echo.
  goto ende
)

del "%XML%" >nul 2>nul

echo.
echo ===========================================================
echo   Eingerichtet.
echo.
echo   Gesichert wird ab jetzt:
echo     - taeglich um 19:00
echo     - beim naechsten Hochfahren, falls 19:00 verpasst wurde
echo     - hoechstens einmal pro Tag
echo.
echo   Nachsehen: Windows-Taste - "Aufgabenplanung" -
echo   "Aufgabenplanungsbibliothek" - "Baukoordination Sicherung"
echo.
echo   Jetzt gleich ausprobieren? Dort Rechtsklick - "Ausfuehren".
echo ===========================================================
echo.

:ende
pause
endlocal
