#!/bin/bash
set -e

echo "=== Restringiendo el menú exclusivamente a chalohiahmd1980@gmail.com ==="

node -e '
const fs = require("fs");

// Modificar CatalogPanel.tsx para comprobar la sesion del usuario
const catalogPath = "src/components/pos/CatalogPanel.tsx";
if (fs.existsSync(catalogPath)) {
  let content = fs.readFileSync(catalogPath, "utf8");

  // Inyectar logica de verificacion de usuario
  content = content.replace(
    /const activeCategory =/,
    `// Obtener el email del usuario logueado en la sesion/localStorage
  const loggedUserRaw = localStorage.getItem("pos_auth_user") || localStorage.getItem("user") || "{}";
  let currentUserEmail = "";
  try {
    const parsed = JSON.parse(loggedUserRaw);
    currentUserEmail = parsed.email || parsed.user?.email || "";
  } catch(e) {}

  const isTargetUser = currentUserEmail.toLowerCase() === TARGET_USER_EMAIL.toLowerCase();

  const activeCategory =`
  );

  // Asegurar que si no es ese usuario, cargue solo su propio catalogo o lista vacia
  content = content.replace(
    /setProductsList\(RESTAURANT_MENU\);/g,
    `setProductsList(isTargetUser ? RESTAURANT_MENU : (props.products || []));`
  );

  fs.writeFileSync(catalogPath, content, "utf8");
}
'

echo "=== Compilando y desplegando ==="
npm run build
git add src/components/pos/CatalogPanel.tsx
git commit -m "security(menu): restringir visibilidad del menu fisico exclusivamente a chalohiahmd1980@gmail.com"
git push origin main

echo "✅ Listo. Ahora solo chalohiahmd1980@gmail.com verá esta carta."
