@echo off
ECHO Starting Boundier Backend...

:: Set the working directory to this backend folder
cd /d "%~dp0"

:: Activate local virtual environment if it exists
IF EXIST "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
) ELSE (
    ECHO Virtual environment not found. Falling back to system Python.
)

:: Verify Python is accessible
where python >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    ECHO Python not found
    pause
    exit /b 1
)

:: Run the Flask app
ECHO Starting Flask server...
python app.py

:: Keep terminal open if there's an error
IF %ERRORLEVEL% NEQ 0 (
    ECHO Failed to start Flask server. Check backend.log for details.
    pause
    exit /b %ERRORLEVEL%
)

pause
