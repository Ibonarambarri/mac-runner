#!/bin/bash

# Sincroniza el proyecto con GitHub y reinstala dependencias limpias

set -e

echo "Obteniendo cambios de GitHub..."
git fetch origin
git reset --hard origin/main

echo "Instalando dependencias del frontend..."
cd frontend
rm -rf node_modules
npm ci

echo "Sincronización completada!"
