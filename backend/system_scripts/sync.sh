#!/bin/bash
# Sync repository with GitHub and reinstall frontend dependencies

set -e

# Navigate to project root (relative to this script's location)
cd "$(dirname "$0")/../.."

echo "📥 Fetching changes from GitHub..."
git fetch origin
git reset --hard origin/main

echo "📦 Installing frontend dependencies..."
cd frontend
rm -rf node_modules
npm ci

echo "✅ Sync completed successfully!"
