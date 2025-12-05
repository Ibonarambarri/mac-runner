#!/bin/bash
# Flush DNS cache (macOS)

echo "🌐 DNS Cache Flush Script"
echo "========================="

echo ""
echo "🔄 Flushing DNS cache..."

# macOS Monterey and later
sudo dscacheutil -flushcache 2>/dev/null
sudo killall -HUP mDNSResponder 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ DNS cache flushed successfully!"
else
    echo "⚠️  May require sudo privileges. Run manually:"
    echo "   sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"
fi

echo ""
echo "🔍 Testing DNS resolution..."
nslookup google.com 2>/dev/null | head -5

echo ""
echo "✅ DNS flush complete!"
