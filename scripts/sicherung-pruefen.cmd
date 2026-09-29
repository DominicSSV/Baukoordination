@echo off
rem ===========================================================================
rem  Baukoordination – "Warum hat es nicht gesichert?"
rem
rem  Doppelklicken. Das Fenster bleibt offen und sagt, woran es liegt.
rem  Ausserdem entsteht daneben die Datei pruefung-sicherung.txt – die kannst
rem  du mir schicken.
rem ===========================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sicherung-pruefen.ps1"

echo.
pause
