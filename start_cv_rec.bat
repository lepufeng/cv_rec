@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -3 start_cv_rec.py
  exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python start_cv_rec.py
  exit /b %ERRORLEVEL%
)

echo Python 3 was not found. Please install Python 3.11 or newer first.
pause
exit /b 1
