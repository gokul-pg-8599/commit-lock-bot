@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
TITLE Commit Lock Server

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

echo.
echo =====================================================
echo   Commit Lock Server
echo =====================================================
echo.
echo   Local:    http://localhost:3000
echo   Network:  http://!LAN_IP!:3000
echo.
echo   Share the Network URL with your team.
echo   Press Ctrl+C to stop.
echo.
echo =====================================================
echo.

cd /d "%~dp0.."
node server\server.js

echo.
echo Server stopped.
pause
