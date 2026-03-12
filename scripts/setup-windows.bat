@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
TITLE Commit Lock System Setup

echo.
echo =====================================================
echo   Commit Lock System - Windows Setup
echo =====================================================
echo.

:: ── Check Node.js ──────────────────────────────────────
node --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo.
  echo  Download from: https://nodejs.org  ^(LTS version, v18 or newer^)
  echo  After installing, re-run this script.
  echo.
  pause
  exit /b 1
)
FOR /F "tokens=*" %%v IN ('node --version') DO SET NODE_VER=%%v
echo [OK]   Node.js found: !NODE_VER!

:: ── Check Node version ≥ 18 ────────────────────────────
FOR /F "tokens=1 delims=." %%m IN ("!NODE_VER:v=!") DO SET NODE_MAJOR=%%m
IF !NODE_MAJOR! LSS 18 (
  echo [ERROR] Node.js v18 or newer is required. You have !NODE_VER!
  echo  Download from: https://nodejs.org
  pause
  exit /b 1
)

:: ── Check Git ───────────────────────────────────────────
git --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo [ERROR] Git is not installed or not in PATH.
  echo  Download from: https://git-scm.com/download/win
  pause
  exit /b 1
)
FOR /F "tokens=*" %%v IN ('git --version') DO SET GIT_VER=%%v
echo [OK]   Git found: !GIT_VER!

:: ── Check curl ──────────────────────────────────────────
curl --version >nul 2>&1
IF ERRORLEVEL 1 (
  echo [WARN] curl not found in PATH. Git hooks require curl.
  echo  curl is included with Windows 10/11 and Git for Windows.
  echo  Make sure Git Bash is installed.
) ELSE (
  echo [OK]   curl found
)

:: ── Install npm dependencies ────────────────────────────
echo.
echo Installing Node.js dependencies...
cd /d "%~dp0.."
CALL npm install --loglevel error
IF ERRORLEVEL 1 (
  echo [ERROR] npm install failed. Check your internet connection.
  pause
  exit /b 1
)
echo [OK]   Dependencies installed (express, ws)

:: ── Check/create config ─────────────────────────────────
IF NOT EXIST "server\config.json" (
  echo.
  echo [INFO] server\config.json not found - this should not happen.
  echo  Please check the repository is complete.
) ELSE (
  echo [OK]   server\config.json found
)

:: ── Get LAN IP ─────────────────────────────────────────
SET LAN_IP=your-machine-ip
FOR /F "tokens=2 delims=:" %%I IN ('ipconfig 2^>nul ^| findstr /C:"IPv4 Address"') DO (
  SET RAW_IP=%%I
  SET RAW_IP=!RAW_IP: =!
  IF NOT "!RAW_IP!"=="" (
    SET LAN_IP=!RAW_IP!
    GOTO :found_ip
  )
)
:found_ip

:: ── Done ────────────────────────────────────────────────
echo.
echo =====================================================
echo   Setup Complete!
echo =====================================================
echo.
echo  NEXT STEPS:
echo.
echo  1. Edit server\config.json:
echo     - Change "allowedUsers" to your team's usernames
echo     - Set "adminKey" to a secret string
echo     - Optionally configure Zoho Cliq webhook
echo.
echo  2. Add a Windows Firewall rule to allow port 3000:
echo     (Run this in an elevated ^(Admin^) Command Prompt^)
echo.
echo       netsh advfirewall firewall add rule ^
echo         name="CommitLockServer" dir=in action=allow ^
echo         protocol=TCP localport=3000
echo.
echo  3. Start the server:
echo       scripts\start-server.bat
echo.
echo  4. Dashboard URL to share with team:
echo       http://!LAN_IP!:3000
echo.
echo  5. From your parent Git repo root, install hooks:
echo       bash hooks/install-hooks.sh
echo       ^(Run in Git Bash^)
echo.
echo  6. Each dev: copy .commit-lock-config.example to
echo     their home directory as .commit-lock-config
echo     and fill in their username + server IP.
echo.
pause
