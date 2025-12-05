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

# Determine port (default: 8000, or use MACRUNNER_PORT env var, or find available)
PORT="${MACRUNNER_PORT:-8000}"

# If --auto-port flag is passed, find an available port
if [[ "$1" == "--auto-port" ]]; then
    PORT=$(python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()")
    echo "Auto-selected port: $PORT"
fi

# Start the server
echo "Starting MacRunner backend on http://0.0.0.0:$PORT"
echo "Set MACRUNNER_PORT env var or use --auto-port to change port"
uvicorn app.main:app --host 0.0.0.0 --port "$PORT" --reload --reload-dir app
