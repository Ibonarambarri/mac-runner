#!/bin/bash
# Kill process using a specific port (default: 8000)

PORT=${1:-8000}

echo "🔫 Kill Process on Port Script"
echo "==============================="
echo "Target port: $PORT"

echo ""
echo "🔍 Looking for processes on port $PORT..."

# Find the PID using lsof
PID=$(lsof -ti:$PORT 2>/dev/null)

if [ -z "$PID" ]; then
    echo "ℹ️  No process found on port $PORT"
    exit 0
fi

echo "Found process(es): $PID"

# Show process details
echo ""
echo "📋 Process details:"
lsof -i:$PORT 2>/dev/null

echo ""
echo "🔫 Killing process(es)..."
kill -9 $PID 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Process killed successfully!"
else
    echo "❌ Failed to kill process. May require sudo."
fi

echo ""
echo "🔍 Verifying port is free..."
sleep 1
NEW_PID=$(lsof -ti:$PORT 2>/dev/null)

if [ -z "$NEW_PID" ]; then
    echo "✅ Port $PORT is now free!"
else
    echo "⚠️  Port $PORT is still in use by PID: $NEW_PID"
fi
