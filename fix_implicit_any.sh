#!/bin/bash
set -e

echo "=== Corrigiendo tipos implícitos any en WaiterPad y PosTerminalPro ==="
node -e '
const fs = require("fs");

const files = ["src/pages/WaiterPad.tsx", "src/pages/PosTerminalPro.tsx"];

files.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");
    // Tipar explícitamente parámetros de suscripciones WS
    content = content.replace(/\((env)\)\s*=>/g, "(env: any) =>");
    content = content.replace(/\((msg)\)\s*=>/g, "(msg: any) =>");
    content = content.replace(/\((data)\)\s*=>/g, "(data: any) =>");
    content = content.replace(/\((event)\)\s*=>/g, "(event: any) =>");
    fs.writeFileSync(f, content, "utf8");
  }
});
'

echo "=== Compilando el proyecto ==="
npm run build

echo "=== Subiendo a GitHub / Vercel ==="
git add src/pages/WaiterPad.tsx src/pages/PosTerminalPro.tsx
git commit -m "fix(types): anadir tipo explicito en callbacks de suscripcion WS"
git push origin main

echo "✅ ¡Build completado al 100% y desplegado en Vercel!"
