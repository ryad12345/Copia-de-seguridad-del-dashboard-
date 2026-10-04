#!/bin/bash
set -e

echo "=== 1. Restaurando App.tsx limpio con rutas estables y ErrorBoundary ==="
cat << 'APP_EOF' > src/App.tsx
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PosTerminalPro } from './pages/PosTerminalPro';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, error: null };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("TPV Crash:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-dvh w-full flex flex-col items-center justify-center bg-slate-900 text-white p-4 text-center">
          <h2 className="text-lg font-bold mb-2">Error al cargar la pantalla</h2>
          <p className="text-xs text-slate-400 mb-4 max-w-md font-mono">{this.state.error?.message}</p>
          <button
            type="button"
            onClick={() => { localStorage.clear(); window.location.href = '/app'; }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
          >
            Limpiar datos y reiniciar TPV
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/app" replace />} />
          <Route path="/app" element={<PosTerminalPro />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
APP_EOF

echo "=== 2. Comprobando sintaxis y compilación ==="
npm run build

echo "=== 3. Subiendo cambios a GitHub ==="
git add src/App.tsx
git commit -m "fix(app): restaurar router principal y anadir ErrorBoundary para evitar pantalla blanca"
git push origin main

echo "✅ ¡Listo! Abre https://mozonatpv.site/app tras el despliegue."
