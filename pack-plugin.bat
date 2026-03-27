@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: pack-plugin.bat — Package the Premiere Pro plugin as a ZIP for distribution
::
:: Run this from the repo root to create a distributable ZIP.
:: Share the resulting ZIP with editors — they just unzip and run install.bat
:: ─────────────────────────────────────────────────────────────────────────────

SET "REPO=%~dp0"
SET "PLUGIN_DIR=%REPO%premiere-plugin"
SET "OUTPUT=%REPO%InsideSuccessTV-Plugin.zip"

echo.
echo  Packaging plugin for distribution...
echo  Source: %PLUGIN_DIR%
echo  Output: %OUTPUT%
echo.

if exist "%OUTPUT%" del "%OUTPUT%"

powershell -NoProfile -Command "& { Compress-Archive -Path '%PLUGIN_DIR%\*' -DestinationPath '%OUTPUT%' -Force; Write-Host '  Done.' }"

if exist "%OUTPUT%" (
  echo.
  echo  SUCCESS: InsideSuccessTV-Plugin.zip is ready to share with editors.
  echo.
  echo  Tell editors:
  echo    1. Download and unzip InsideSuccessTV-Plugin.zip
  echo    2. Right-click install.bat -^> Run as Administrator
  echo    3. Restart Premiere Pro
  echo    4. Window -^> Extensions -^> Inside Success TV - Cut Sheet
  echo    5. Enter the API URL in the Backend field
  echo.
) else (
  echo  ERROR: ZIP creation failed. Make sure PowerShell is available.
)
pause
