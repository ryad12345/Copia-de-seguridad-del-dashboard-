#!/bin/bash
set -e

echo "=== Corrigiendo tipo de timerRef en PaymentPanel.tsx ==="
sed -i 's/useRef<NodeJS.Timeout | null>/useRef<any>/g' src/components/pos/PaymentPanel.tsx

echo "=== Compilando y desplegando ==="
npm run build
git add src/components/pos/PaymentPanel.tsx
git commit -m "fix(types): reemplazar NodeJS.Timeout por any en PaymentPanel"
git push origin main

echo "✅ ¡Build completado con éxito y subido a Vercel!"
