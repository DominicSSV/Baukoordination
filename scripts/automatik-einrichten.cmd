@echo off
rem ===========================================================================
rem  Baukoordination – taegliche Sicherung automatisch einrichten (Windows)
rem
rem  Doppelklicken. Traegt den Auftrag "Baukoordination Sicherung" in die
rem  Windows-Aufgabenplanung ein: taeglich um 08:00 und beim Hochfahren,
rem  falls 08:00 verpasst wurde.
rem
rem  Verwaltungsrechte braucht es nicht – der Auftrag laeuft unter dem
rem  angemeldeten Benutzer.
rem
rem  Nochmals ausfuehren ist unschaedlich: Ein bestehender Auftrag wird
rem  ersetzt. Genau so repariert man ihn auch, wenn das Projekt umgezogen ist.
rem ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0automatik-einrichten.ps1"

pause
