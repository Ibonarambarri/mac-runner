#!/bin/bash
# Clean up unused Docker resources (images, containers, volumes, networks)

echo "🐳 Docker Cleanup Script"
echo "========================"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running or not installed"
    exit 1
fi

echo ""
echo "📊 Current Docker disk usage:"
docker system df

echo ""
echo "🧹 Removing stopped containers..."
docker container prune -f

echo ""
echo "🧹 Removing unused images..."
docker image prune -f

echo ""
echo "🧹 Removing unused volumes..."
docker volume prune -f

echo ""
echo "🧹 Removing unused networks..."
docker network prune -f

echo ""
echo "📊 Docker disk usage after cleanup:"
docker system df

echo ""
echo "✅ Docker cleanup complete!"
