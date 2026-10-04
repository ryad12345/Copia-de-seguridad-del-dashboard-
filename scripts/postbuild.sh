#!/usr/bin/env bash
# =====================================================================
# MOZONA TPV — postbuild.sh
# =====================================================================
# Copia assets estaticos que Vite no incluye automaticamente al dist.
# Esencial para que Cloudflare Pages sirva /database/*.sql y /icons/*.svg
# =====================================================================
set -e

cd "$(dirname "$0")/.."

echo "==> [postbuild] Copiando database/*.sql a dist/database/"
mkdir -p dist/database
cp -v database/*.sql dist/database/ 2>&1 | head -5
echo "    SQL files: $(ls dist/database/*.sql | wc -l)"

echo "==> [postbuild] Copiando icons/ a dist/icons/"
mkdir -p dist/icons
cp -v icons/* dist/icons/ 2>&1 | head -5

echo "==> [postbuild] OK"
