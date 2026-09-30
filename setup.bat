@echo off
rem EVIL TRACE setup (windows) — no npm install, no deps. just wires things up.
setlocal

echo [*] EVIL TRACE setup
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [!] node not found. grab Node.js 22.5+ from https://nodejs.org then re-run this.
  pause
  exit /b 1
)

for /f "tokens=1 delims=v." %%V in ('node -v') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 22 (
  echo [!] node %NODE_MAJOR% is too old. need 22.5+.
  pause
  exit /b 1
)
echo [+] node ok

if not exist reports mkdir reports
if not exist data mkdir data

rem shim so `eviltrace` runs from this folder
> eviltrace.bat echo @echo off
>> eviltrace.bat echo node "%%~dp0bin\eviltrace.js" %%*
echo [+] eviltrace command ready

echo.
echo [*] running self-check...
call node --test >nul 2>&1
if errorlevel 1 (
  echo [!] self-check failed. something's off — open an issue.
) else (
  echo [+] self-check passed
)

echo.
set /p ADDPATH="add this folder to PATH so eviltrace works anywhere? [y/N] "
if /i "%ADDPATH%"=="y" (
  setx PATH "%PATH%;%CD%" >nul 2>&1
  echo [+] added. reopen your terminal, then run: eviltrace torvalds --quick
) else (
  echo [*] skipped. run it from here: eviltrace torvalds --quick
)

echo.
echo done.
pause
