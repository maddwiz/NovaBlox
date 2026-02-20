@echo off
setlocal

cd /d %~dp0\..

if not exist node_modules (
  echo [NovaBlox] Installing npm dependencies...
  call npm install
  if errorlevel 1 (
    echo [NovaBlox] npm install failed.
    exit /b 1
  )
)

echo [NovaBlox] Starting bridge server on http://localhost:30010
call npm start
