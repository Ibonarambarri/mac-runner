#!/bin/bash
# MacRunner - Frontend Startup Script

cd "$(dirname "$0")/frontend"

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the dev server (--host exposes on network for Tailscale)
echo "Starting MacRunner frontend..."
echo "  Local:   http://localhost:5173"
echo "  Network: Available on all interfaces"
npm run dev
