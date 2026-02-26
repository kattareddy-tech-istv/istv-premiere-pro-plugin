@echo off
cd /d "%~dp0"
if exist venv\Scripts\activate.bat (
  call venv\Scripts\activate.bat
) else (
  echo No venv found. Create one with: python -m venv venv
  echo Then: venv\Scripts\activate  and  pip install -r requirements.txt
  exit /b 1
)
echo Starting backend at http://localhost:8000
echo API docs: http://localhost:8000/docs
uvicorn app.main:app --reload --port 8000
