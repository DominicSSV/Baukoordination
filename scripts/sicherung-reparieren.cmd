@echo off
rem ===========================================================================
rem  Baukoordination – Sicherung reparieren und auf der Stelle beweisen
rem
rem  Doppelklicken. Raeumt die alten Auftraege weg, traegt einen sauberen ein,
rem  startet ihn sofort und sagt am Ende, ob wirklich eine Sicherung von heute
rem  im Zielordner liegt.
rem
rem  Das Fenster bitte offen lassen, bis "ES LAEUFT" oder "NOCH NICHT"
rem  dasteht - der Probelauf dauert ein bis fuenf Minuten.
rem ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sicherung-reparieren.ps1"

echo.
pause
