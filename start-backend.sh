#!/bin/bash
# MacRunner - Backend Startup Script

cd "$(dirname "$0")/backend"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the server
echo "Starting MacRunner backend on http://localhost:8000"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
