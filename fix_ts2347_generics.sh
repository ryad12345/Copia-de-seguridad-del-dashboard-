#!/bin/bash
set -e

echo "=== 1. Tipando subscribe genérico en WebSocketProvider/Context ==="
node -e '
const fs = require("fs");
const wsFiles = ["src/hooks/WebSocketProvider.tsx", "src/context/WebSocketContext.tsx", "src/contexts/WebSocketContext.tsx"];

wsFiles.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");
    content = content.replace(/subscribe\s*:\s*\([^)]*\)\s*=>\s*any/g, "subscribe: <T = any>(event: string, callback: (payload: any) => void) => () => {}");
    content = content.replace(/subscribe\s*\?\s*:\s*\([^)]*\)\s*=>\s*any/g, "subscribe?: <T = any>(event: string, callback: (payload: any) => void) => () => {}");
    fs.writeFileSync(f, content, "utf8");
  }
});
'

echo "=== 2. Eliminando genéricos superfluos en PosTerminalPro.tsx y WaiterPad.tsx ==="
node -e '
const fs = require("fs");
const files = ["src/pages/PosTerminalPro.tsx", "src/pages/WaiterPad.tsx"];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");
    // Quitar <"TIPO_EVENTO"> de ws.subscribe<...>(
    content = content.replace(/ws\.subscribe\s*<[^>]+>\s*\(/g, "ws.subscribe(");
    fs.writeFileSync(f, content, "utf8");
  }
});
'

echo "=== 3. Compilando el proyecto ==="
npm run build

echo "=== 4. Subiendo a GitHub / Vercel ==="
git add -A
git commit -m "fix(types): corregir llamadas genericas TS2347 en ws.subscribe"
git push origin main

echo "========================================================"
echo "✅ ¡COMPILADO SIN ERRORES Y DESPLEGADO EN PRODUCCIÓN!"
echo "========================================================"
