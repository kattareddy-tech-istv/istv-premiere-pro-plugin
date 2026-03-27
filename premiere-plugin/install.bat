@echo off
setlocal EnableDelayedExpansion
:: ─────────────────────────────────────────────────────────────────────────────
:: install.bat — One-click installer for the Inside Success TV Premiere Pro Plugin
::
:: HOW TO USE:
::   1. Right-click this file and choose "Run as administrator"
::   2. Restart Adobe Premiere Pro
::   3. Window > Extensions > Inside Success TV — Cut Sheet
:: ─────────────────────────────────────────────────────────────────────────────

SET "PLUGIN_SRC=%~dp0"
SET "PLUGIN_NAME=com.insidesuccesstv.cutsheet"
SET "PLUGIN_DEST=%APPDATA%\Adobe\CEP\extensions\%PLUGIN_NAME%"

cls
echo.
echo  ============================================================
echo   Inside Success TV - AI Cut Sheet + Multicam Plugin
echo   Installer v2.0
echo  ============================================================
echo.
echo  Installing to: %PLUGIN_DEST%
echo.
pause

:: ── Step 1: Enable unsigned CEP extensions ─────────────────────────────────
echo.
echo  [1/4] Enabling plugin loading in Adobe...
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.8"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
echo       Done.

:: ── Step 2: Remove old version ──────────────────────────────────────────────
echo.
echo  [2/4] Removing old version (if any)...
if exist "%PLUGIN_DEST%" (
  rmdir /s /q "%PLUGIN_DEST%"
  echo       Removed old version.
) else (
  echo       No previous installation found.
)

:: ── Step 3: Copy plugin files ───────────────────────────────────────────────
echo.
echo  [3/4] Copying plugin files...
if not exist "%APPDATA%\Adobe\CEP\extensions" mkdir "%APPDATA%\Adobe\CEP\extensions"
xcopy /e /i /y "%PLUGIN_SRC%" "%PLUGIN_DEST%" >nul
if errorlevel 1 (
  echo  ERROR: Could not copy files.
  echo  Make sure Premiere Pro is CLOSED and try again.
  pause
  exit /b 1
)
echo       Done.

:: ── Step 4: Get CSInterface.js ──────────────────────────────────────────────
echo.
echo  [4/4] Checking for Adobe CSInterface.js...

if exist "%PLUGIN_DEST%\CSInterface.js" (
  echo       Already included.
  goto DONE
)

:: Try common SDK locations
for %%P in (
  "%APPDATA%\Adobe\CEP\CEP_12_SDK\CSInterface.js"
  "%APPDATA%\Adobe\CEP\CEP_11_SDK\CSInterface.js"
  "%APPDATA%\Adobe\CEP\CEP_10_SDK\CSInterface.js"
  "%APPDATA%\Adobe\CEP\CEP_8_SDK\CSInterface.js"
) do (
  if exist %%P (
    copy /y %%P "%PLUGIN_DEST%\CSInterface.js" >nul
    echo       Copied from local Adobe SDK.
    goto DONE
  )
)

:: Download from GitHub
echo       Downloading from Adobe GitHub...
powershell -NoProfile -Command "& { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_12.x/CSInterface.js' -OutFile '%PLUGIN_DEST%\CSInterface.js' -TimeoutSec 30; Write-Host '      Downloaded successfully.' } catch { Write-Host '      Could not download automatically.' } }"

if not exist "%PLUGIN_DEST%\CSInterface.js" (
  echo.
  echo  ACTION REQUIRED: Could not get CSInterface.js automatically.
  echo.
  echo  Please do this manually:
  echo    1. Open this URL in a browser:
  echo       https://github.com/Adobe-CEP/CEP-Resources/tree/master/CEP_12.x
  echo    2. Click "CSInterface.js" then "Download raw file"
  echo    3. Save it here: %PLUGIN_DEST%\CSInterface.js
  echo.
)

:DONE
echo.
echo  ============================================================
echo   Installation Complete!
echo  ============================================================
echo.
echo  NEXT STEPS FOR EDITORS:
echo.
echo  1. RESTART Adobe Premiere Pro (fully close and reopen it)
echo.
echo  2. Open the plugin panel:
echo       Window  ^>  Extensions  ^>  "Inside Success TV - Cut Sheet"
echo.
echo  3. In the "Backend" section at the top of the panel:
echo       Enter the API URL your team lead gave you
echo       Click "Test Connection" to confirm it works
echo.
echo  4. HOW TO USE MULTICAM AI EDIT:
echo       a. Open a sequence in Premiere Pro that has
echo          multiple camera tracks (V1, V2, etc.)
echo       b. In the plugin panel, scroll to "Multicam AI Edit"
echo       c. Click "Scan Active Sequence"
echo       d. Click "Analyze with Claude"
echo       e. Review each suggested cut (check/uncheck as needed)
echo       f. Click "Apply Selected Cuts" to cut, OR
echo          "Markers Only" to just see the suggestions as markers
echo.
echo  Need help? Contact your team lead.
echo.
pause
