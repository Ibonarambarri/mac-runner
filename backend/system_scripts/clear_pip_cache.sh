#!/bin/bash
# Clear pip cache to free up disk space

echo "🐍 Pip Cache Cleanup Script"
echo "==========================="

echo ""
echo "📊 Current pip cache info:"
pip cache info 2>/dev/null || pip3 cache info 2>/dev/null

echo ""
echo "🧹 Clearing pip cache..."
pip cache purge 2>/dev/null || pip3 cache purge 2>/dev/null

echo ""
echo "✅ Pip cache cleared!"

# Also clear uv cache if available
if command -v uv &> /dev/null; then
    echo ""
    echo "🦀 Clearing uv cache..."
    uv cache clean
    echo "✅ uv cache cleared!"
fi
