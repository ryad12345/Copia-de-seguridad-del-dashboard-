#!/bin/bash
set -e

echo "=== Exportando RestaurantForm en src/pages/SettingsPage.tsx ==="
node -e '
const fs = require("fs");
const file = "src/pages/SettingsPage.tsx";

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, "utf8");
  if (!content.includes("export interface RestaurantForm")) {
    const typeDef = `export interface RestaurantForm {
  name?: string;
  nif?: string;
  address?: string;
  phone?: string;
  ticketHeader?: string;
  ticketFooter?: string;
  [key: string]: any;
}\n\n`;
    content = typeDef + content;
    fs.writeFileSync(file, content, "utf8");
  }
}
'

echo "=== Compilando y desplegando ==="
npm run build
git add src/pages/SettingsPage.tsx
git commit -m "fix(types): exportar RestaurantForm en SettingsPage"
git push origin main

echo "✅ ¡Build completado y desplegado con éxito!"
