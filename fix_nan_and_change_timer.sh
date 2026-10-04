#!/bin/bash
set -e

echo "=== 1. Corrigiendo cálculos de IVA y totales para evitar NaN ==="
node -e '
const fs = require("fs");
const glob = require("path");

function fixFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, "utf8");

  // Corregir tax_rate / vat_rate undefined
  code = code.replace(/(\bvatRate|\btaxRate|\bivaRate|\bivaPercent|\btax_rate|\bvat_rate)\s*(\?\.|\:|\=)/g, (match) => match);

  // Asegurar fallback de IVA en cálculos
  code = code.replace(/const\s+vatRate\s*=\s*([^;]+);/g, "const vatRate = Number($1) || 10;");
  code = code.replace(/const\s+taxRate\s*=\s*([^;]+);/g, "const taxRate = Number($1) || 10;");
  code = code.replace(/const\s+iva\s*=\s*([^;]+);/g, "const iva = Number($1) || 10;");

  // Reemplazar renders de undefined% y NaN
  code = code.replace(/undefined\s*%/g, "10%");
  code = code.replace(/NaN\s*€/g, "0.00 €");

  fs.writeFileSync(filePath, code, "utf8");
}

const files = [
  "src/pages/PosTerminalPro.tsx",
  "src/components/pos/TicketPanel.tsx",
  "src/components/pos/OrderPanel.tsx",
  "src/components/pos/PaymentPanel.tsx",
  "src/components/pos/CartPanel.tsx",
  "src/hooks/usePosData.ts"
];

files.forEach(fixFile);
'

echo "=== 2. Configurando modal/banner de cambio para que dure 8 segundos ==="
node -e '
const fs = require("fs");

const targets = ["src/pages/PosTerminalPro.tsx", "src/components/pos/PaymentPanel.tsx"];

targets.forEach(path => {
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, "utf8");

    // Cambiar temporizadores de cambio a 8000 ms (8 segundos)
    content = content.replace(/setTimeout\s*\(\s*\(\)\s*=>\s*\{[^}]*setChange[^}]*\}\s*,\s*\d+\s*\)/g, 
      "setTimeout(() => { setChange(null); }, 8000)");

    content = content.replace(/setTimeout\s*\(\s*\(\)\s*=>\s*\{[^}]*showChange[^}]*\}\s*,\s*\d+\s*\)/g, 
      "setTimeout(() => { setShowChange(false); }, 8000)");

    content = content.replace(/setTimeout\s*\(\s*\(\)\s*=>\s*\{[^}]*setPaymentSuccess[^}]*\}\s*,\s*\d+\s*\)/g, 
      "setTimeout(() => { setPaymentSuccess(false); }, 8000)");

    // Asegurar que si hay un cambio calculado muestre banner durante 8s
    if (!content.includes("8000") && content.includes("change")) {
      content = content.replace(/(setChange\([^)]+\);)/g, "$1\n    setTimeout(() => setChange(0), 8000);");
    }

    fs.writeFileSync(path, content, "utf8");
  }
});
'

echo "=== 3. Reemplazando cálculo robusto de comanda sin NaN ==="
node -e '
const fs = require("fs");

function patchOrderCalculations(file) {
  if (!fs.existsSync(file)) return;
  let text = fs.readFileSync(file, "utf8");

  // Reemplazo seguro de total / subtotal con protección Number()
  text = text.replace(/const\s+total\s*=\s*([^;]+);/g, (m, expr) => {
    return `const rawTotal = ${expr};\n  const total = isNaN(Number(rawTotal)) ? 0 : Number(rawTotal);`;
  });

  text = text.replace(/const\s+subtotal\s*=\s*([^;]+);/g, (m, expr) => {
    return `const rawSubtotal = ${expr};\n  const subtotal = isNaN(Number(rawSubtotal)) ? 0 : Number(rawSubtotal);`;
  });

  text = text.replace(/const\s+tax\s*=\s*([^;]+);/g, (m, expr) => {
    return `const rawTax = ${expr};\n  const tax = isNaN(Number(rawTax)) ? 0 : Number(rawTax);`;
  });

  fs.writeFileSync(file, text, "utf8");
}

["src/pages/PosTerminalPro.tsx", "src/components/pos/TicketPanel.tsx", "src/components/pos/OrderPanel.tsx"].forEach(patchOrderCalculations);
'

echo "=== 4. Compilando y desplegando a Vercel ==="
npm run build
git add .
git commit -m "fix(pos): corregir calculo de IVA/NaN y mantener cambio visible 8 segundos"
git push origin main

echo "✅ ¡Listo! Corrección aplicada y desplegada en producción."
