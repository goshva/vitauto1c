@echo off
setlocal
rem ============================================================
rem  Zakaz-naryad: remove discount columns and "Platelshchik" row
rem    zn-fix.bat          - fix the print layout
rem    zn-fix.bat check    - only show current state
rem    zn-fix.bat revert   - undo (restore from zn-backup.json)
rem  Details: README.txt
rem ============================================================

rem ---- SETTINGS ----------------------------------------------
rem  OData address of the production infobase:
set "ODATA=http://localhost/autoservice/odata/standard.odata"
rem  1C user with full rights. Empty = default admin user (set in zn-fix.ps1).
rem  Use only Latin names here, e.g. set "USER1C=arm.admin"
set "USER1C="
rem ------------------------------------------------------------

set "MODE=%~1"
if "%MODE%"=="" set "MODE=apply"

if defined USER1C (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zn-fix.ps1" -Mode %MODE% -OData "%ODATA%" -User "%USER1C%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zn-fix.ps1" -Mode %MODE% -OData "%ODATA%"
)
echo.
pause