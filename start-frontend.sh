#!/bin/bash
# MacRunner - Frontend Startup Script

cd "$(dirname "$0")/frontend"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Determine port (default: 5173, or use MACRUNNER_FRONTEND_PORT env var)
PORT="${MACRUNNER_FRONTEND_PORT:-5173}"

# Start the dev server (--host exposes on network for Tailscale)
echo "Starting MacRunner frontend..."
echo "  Local:   http://localhost:$PORT"
echo "  Network: Available on all interfaces"
echo ""
echo "Set VITE_API_URL in .env to configure backend API URL"
echo "Set MACRUNNER_FRONTEND_PORT env var to change frontend port"
npm run dev -- --port "$PORT"
