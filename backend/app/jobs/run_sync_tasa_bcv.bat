@echo off
REM Wrapper para la Tarea Programada de Windows (ver README.md en esta carpeta).
REM Activa el venv de backend/, corre sync_tasa_bcv.py y guarda todo en logs/.

setlocal

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%..\..\"
set "LOG_DIR=%SCRIPT_DIR%logs"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_DIR%\sync_tasa_bcv.log"
echo ==== %date% %time% ==== >> "%LOG_DIR%\sync_tasa_bcv.log"

call "%BACKEND_DIR%.venv\Scripts\activate.bat"
"%BACKEND_DIR%.venv\Scripts\python.exe" "%SCRIPT_DIR%sync_tasa_bcv.py" >> "%LOG_DIR%\sync_tasa_bcv.log" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
call "%BACKEND_DIR%.venv\Scripts\deactivate.bat"

endlocal & exit /b %EXIT_CODE%
