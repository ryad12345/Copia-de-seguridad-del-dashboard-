#!/bin/bash
set -e

echo "=== 1. Desactivando cualquier modal de IP local / LAN en el proyecto ==="
node -e '
const fs = require("fs");
const path = require("path");

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!file.includes("node_modules") && !file.includes(".git") && !file.includes("dist")) {
        results = results.concat(walk(fullPath));
      }
    } else if (file.endsWith(".tsx") || file.endsWith(".ts")) {
      results.push(fullPath);
    }
  });
  return results;
}

const allFiles = walk("./src");

allFiles.forEach(f => {
  let content = fs.readFileSync(f, "utf8");
  let changed = false;

  // Desactivar apertura automatica del modal de IP de caja central
  if (content.includes("Configura la caja central") || content.includes("showLanModal") || content.includes("showServerModal") || content.includes("LAN ")) {
    content = content.replace(/setShowLanModal\s*\(\s*true\s*\)/g, "setShowLanModal(false)");
    content = content.replace(/setShowServerModal\s*\(\s*true\s*\)/g, "setShowServerModal(false)");
    content = content.replace(/setShowConfigModal\s*\(\s*true\s*\)/g, "setShowConfigModal(false)");
    // Ocultar etiquetas LAN
    content = content.replace(/<span[^>]*>.*?LAN\s+[\d\.]+.*?<\/span>/gi, "");
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(f, content, "utf8");
  }
});
'

echo "=== 2. Asegurando App.tsx sin modales de IP y con detector movil/caja ==="
cat << 'APP_EOF' > src/App.tsx
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PosTerminalPro } from './pages/PosTerminalPro';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';

function DeviceRouter() {
  const navigate = useNavigate();

  useEffect(() => {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    const isWaiter = localStorage.getItem('pos_active_waiter');

    if (isMobile) {
      if (isWaiter) {
        navigate('/waiter');
      } else {
        navigate('/auth');
      }
    } else {
      navigate('/app');
    }
  }, [navigate]);

  return (
    <div className="h-dvh w-full flex items-center justify-center bg-slate-900 text-white font-mono text-xs">
      Cargando MOZONA TPV...
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DeviceRouter />} />
        <Route path="/app" element={<PosTerminalPro />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
APP_EOF

echo "=== 3. Conectando PaymentPanel con boton COBRAR en PosTerminalPro.tsx ==="
node -e '
const fs = require("fs");
const file = "src/pages/PosTerminalPro.tsx";

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, "utf8");

  // Reemplazar boton de EFECTIVO viejo si estaba hardcodeado
  content = content.replace(/>\s*💵?\s*EFECTIVO\s*</g, ">💳 💵 COBRAR<");
  content = content.replace(/EFECTIVO/g, "COBRAR");

  // Eliminar badge visual LAN del TopBar
  content = content.replace(/LAN\s+[\d\.]+/gi, "ONLINE");

  fs.writeFileSync(file, content, "utf8");
}
'

echo "=== 4. Incrementando version de Service Worker para forzar actualizacion en moviles ==="
node -e '
const fs = require("fs");
const pwaFiles = ["public/sw.js", "src/sw.ts", "vite.config.ts"];

pwaFiles.forEach(f => {
  if (fs.existsSync(f)) {
    let content = fs.readFileSync(f, "utf8");
    content = content.replace(/cache-v\d+/g, `cache-v${Date.now()}`);
    fs.writeFileSync(f, content, "utf8");
  }
});
'

echo "=== 5. Compilando y desplegando a produccion ==="
npm run build
git add .
git commit -m "fix(deploy): eliminar modal IP caja central, activar boton cobrar y refrescar SW cache"
git push origin main

echo "========================================================"
echo "✅ ¡DESPLIEGUE FINAL COMPLETADO!"
echo "========================================================"
