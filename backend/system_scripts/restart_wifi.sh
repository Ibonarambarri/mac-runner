#!/bin/bash
# Restart WiFi connection (macOS only)

echo "📶 WiFi Restart Script"
echo "======================"

# Detect the active network interface
WIFI_INTERFACE=$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2}')

if [ -z "$WIFI_INTERFACE" ]; then
    echo "❌ Could not detect WiFi interface"
    exit 1
fi

echo "Detected WiFi interface: $WIFI_INTERFACE"

echo ""
echo "📴 Turning WiFi off..."
networksetup -setairportpower "$WIFI_INTERFACE" off

sleep 2

echo ""
echo "📶 Turning WiFi on..."
networksetup -setairportpower "$WIFI_INTERFACE" on

sleep 3

echo ""
echo "🔍 Checking connection status..."
CURRENT_NETWORK=$(networksetup -getairportnetwork "$WIFI_INTERFACE" 2>/dev/null | cut -d: -f2 | xargs)

if [ -n "$CURRENT_NETWORK" ]; then
    echo "✅ Connected to: $CURRENT_NETWORK"
else
    echo "⚠️  Not connected to any network yet. May take a few seconds..."
fi

echo ""
echo "✅ WiFi restart complete!"
