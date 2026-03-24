@echo off
setlocal
set "ROOT=%~dp0"
cd /d "%ROOT%"

echo Killing processes on ports 3000 and 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 "') do taskkill /F /PID %%a 2>nul
timeout /t 2 /nobreak >nul

echo Starting backend...
start "Backend" cmd /k "cd /d "%ROOT%backend" && (if exist venv\Scripts\activate.bat call venv\Scripts\activate.bat) && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo Starting frontend...
start "Frontend" cmd /k "cd /d "%ROOT%frontend" && npm run dev"

echo Waiting for servers to start...
timeout /t 6 /nobreak >nul

echo Opening Post Audio step in browser...
start "" "http://localhost:3000/?pipeline=broll"

echo Done. Backend and frontend are running in separate windows.
exit /b 0
