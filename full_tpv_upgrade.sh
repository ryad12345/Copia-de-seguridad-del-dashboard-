#!/bin/bash
set -e

echo "=== 1. Limpiando menciones de IP local / LAN del Header ==="
node -e '
const fs = require("fs");
const files = ["src/pages/PosTerminalPro.tsx", "src/components/layout/TopBar.tsx", "src/components/pos/Header.tsx"];

files.forEach(path => {
  if (fs.existsSync(path)) {
    let content = fs.readFileSync(path, "utf8");
    // Eliminar badges de LAN / IP local
    content = content.replace(/\{?\/\*.*LAN.*\*\/\}?/gi, "");
    content = content.replace(/<[^>]*LAN\s+[0-9\.]*[^>]*>.*?<\/[^>]*>/gi, "");
    content = content.replace(/LAN\s+[0-9\.]+/gi, "ONLINE");
    fs.writeFileSync(path, content, "utf8");
  }
});
'

echo "=== 2. Actualizando PaymentPanel.tsx (Botón único COBRAR + 6s + Vaciar comanda) ==="
cat << 'PAY_EOF' > src/components/pos/PaymentPanel.tsx
import React, { useState, useEffect, useRef } from 'react';

export interface PaymentPanelProps {
  total?: number;
  paymentAmount?: string | number;
  onPay?: (method: 'cash' | 'card', received?: number, change?: number) => void;
  onClearTable?: () => void;
  onEmitInvoice?: () => void;
  [key: string]: any;
}

export function PaymentPanel(props: PaymentPanelProps) {
  const { total = 0, onPay, onClearTable, onEmitInvoice } = props;
  const [receivedAmount, setReceivedAmount] = useState<string>('0');
  const [changeInfo, setChangeInfo] = useState<{ received: number; change: number } | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (props.paymentAmount !== undefined && !changeInfo) {
      setReceivedAmount(String(props.paymentAmount));
    }
  }, [props.paymentAmount, changeInfo]);

  const handleNumClick = (val: string) => {
    if (changeInfo) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setChangeInfo(null);
    }

    if (val === 'C') {
      setReceivedAmount('0');
    } else if (val === 'DEL') {
      setReceivedAmount(prev => (prev.length > 1 ? prev.slice(0, -1) : '0'));
    } else {
      setReceivedAmount(prev => (prev === '0' ? val : prev + val));
    }
  };

  const handleCobrar = () => {
    const finalTotal = Number(total) || 0;
    const recNum = parseFloat(receivedAmount) > 0 ? parseFloat(receivedAmount) : finalTotal;
    const calculatedChange = Math.max(0, recNum - finalTotal);

    setChangeInfo({ received: recNum, change: calculatedChange });

    if (onPay) {
      onPay('cash', recNum, calculatedChange);
    }

    // Mantener quieto en pantalla durante 6 segundos y vaciar mesa
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setChangeInfo(null);
      setReceivedAmount('0');
      if (typeof onClearTable === 'function') {
        onClearTable();
      } else if (typeof props.onEmptyCart === 'function') {
        props.onEmptyCart();
      }
    }, 6000);
  };

  return (
    <div className="h-full flex flex-col justify-between p-2 min-h-0 select-none">
      {/* Display Principal */}
      <div className="bg-slate-900 text-white p-3 rounded-2xl flex flex-col justify-center shrink-0 shadow-inner">
        {changeInfo ? (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-xs text-slate-400 font-bold uppercase">
              <span>Recibido</span>
              <span className="text-white text-sm">{changeInfo.received.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between items-baseline border-t border-slate-700/80 pt-1 mt-0.5">
              <span className="text-xs font-black text-emerald-400 tracking-wider">A DEVOLVER</span>
              <span className="text-2xl font-black text-emerald-400">{changeInfo.change.toFixed(2)} €</span>
            </div>
            <span className="text-[10px] text-slate-400 text-right mt-0.5">Vaciando mesa en 6s...</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Importe Recibido</span>
            <span className="text-2xl font-black">{receivedAmount} €</span>
          </div>
        )}
      </div>

      {/* Teclado Numérico */}
      <div className="grid grid-cols-3 gap-1 my-2 flex-1">
        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', 'DEL'].map(btn => (
          <button
            key={btn}
            type="button"
            onClick={() => handleNumClick(btn)}
            className="h-full min-h-[36px] rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-white font-black text-base shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition flex items-center justify-center"
          >
            {btn === 'DEL' ? '⌫' : btn}
          </button>
        ))}
      </div>

      {/* Botón único COBRAR */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleCobrar}
          className="w-full h-12 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-base rounded-xl shadow-md transition active:scale-95 flex items-center justify-center gap-2"
        >
          💳 💵 COBRAR
        </button>
        {onEmitInvoice && (
          <button
            type="button"
            onClick={onEmitInvoice}
            className="w-full h-6 text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white transition text-center"
          >
            Emitir Factura VeriFactu
          </button>
        )}
      </div>
    </div>
  );
}

export default PaymentPanel;
PAY_EOF

echo "=== 3. Mejorando nitidez de impresión en index.html / CSS Global ==="
cat << 'CSS_EOF' >> src/index.css

/* Corrección de nitidez térmica para tickets */
@media print {
  body, html, #root {
    background: #ffffff !important;
    color: #000000 !important;
  }
  .no-print {
    display: none !important;
  }
  .print-ticket {
    display: block !important;
    width: 100% !important;
    max-width: 80mm !important;
    margin: 0 auto !important;
    color: #000000 !important;
    font-family: 'Courier New', Courier, monospace !important;
    font-weight: 700 !important;
    font-size: 13px !important;
    line-height: 1.25 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .print-ticket * {
    color: #000000 !important;
    text-shadow: none !important;
  }
}
CSS_EOF

echo "=== 4. Creando panel de Camareros y Gestión de Ticket en SettingsPage.tsx ==="
cat << 'SETTINGS_EOF' > src/pages/SettingsPage.tsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemsPanel } from '../components/settings/ItemsPanel';
import { TablesPanel } from '../components/settings/TablesPanel';
import { CategoriesPanel } from '../components/settings/CategoriesPanel';

export function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'articulos' | 'mesas' | 'categorias' | 'camareros' | 'ticket'>('articulos');

  // Estado de Camareros
  const [waiters, setWaiters] = useState<any[]>([]);
  const [waiterName, setWaiterName] = useState('');

  // Estado de Diseño de Ticket
  const [ticketConfig, setTicketConfig] = useState({
    header: 'RESTAURANTE MOZONA\nNIF: B12345678\nCalle Mayor 12\nTel: 600 000 000',
    footer: '¡Gracias por su visita!\nConserve este ticket',
    showTax: true,
    fontSize: 'normal'
  });

  useEffect(() => {
    try {
      const savedW = localStorage.getItem('pos_waiters_list');
      if (savedW) setWaiters(JSON.parse(savedW));

      const savedT = localStorage.getItem('pos_ticket_config');
      if (savedT) setTicketConfig(JSON.parse(savedT));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleAddWaiter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!waiterName.trim()) return;

    const cleanUser = waiterName.trim().toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(10 + Math.random() * 89);
    const randomPass = Math.random().toString(36).slice(-6);

    const newWaiter = {
      id: `w_${Date.now()}`,
      name: waiterName.trim(),
      username: cleanUser,
      password: randomPass,
      created_at: new Date().toLocaleDateString()
    };

    const updated = [newWaiter, ...waiters];
    setWaiters(updated);
    localStorage.setItem('pos_waiters_list', JSON.stringify(updated));
    setWaiterName('');
  };

  const handleDeleteWaiter = (id: string) => {
    const updated = waiters.filter(w => w.id !== id);
    setWaiters(updated);
    localStorage.setItem('pos_waiters_list', JSON.stringify(updated));
  };

  const handleSaveTicket = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('pos_ticket_config', JSON.stringify(ticketConfig));
    alert('Configuración de ticket guardada.');
  };

  return (
    <div className="min-h-dvh w-full bg-slate-100 dark:bg-slate-900 flex flex-col p-4 sm:p-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/app')}
            className="h-10 px-4 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-bold text-xs rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-2 active:scale-95 transition"
          >
            ⬅ VOLVER AL TPV
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Panel de Configuración</h1>
            <p className="text-xs text-slate-500">Gestión de menú, camareros y tickets</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 mb-4 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('articulos')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${activeTab === 'articulos' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          Artículos (Platos y Bebidas)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('camareros')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${activeTab === 'camareros' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          Camareros / Usuarios
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ticket')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${activeTab === 'ticket' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          Diseño del Ticket
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mesas')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${activeTab === 'mesas' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          Mesas
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categorias')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${activeTab === 'categorias' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}
        >
          Categorías
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex-1 shadow-sm">
        {activeTab === 'articulos' && <ItemsPanel />}
        {activeTab === 'mesas' && <TablesPanel />}
        {activeTab === 'categorias' && <CategoriesPanel />}

        {/* GESTIÓN DE CAMAREROS */}
        {activeTab === 'camareros' && (
          <div className="flex flex-col gap-6 max-w-2xl">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Equipo y Camareros</h3>
              <p className="text-xs text-slate-500">Crea credenciales automáticas para que los camareros comanden desde el móvil.</p>
            </div>

            <form onSubmit={handleAddWaiter} className="flex gap-2">
              <input
                type="text"
                required
                value={waiterName}
                onChange={e => setWaiterName(e.target.value)}
                placeholder="Nombre del camarero (ej. Ali, Omar...)"
                className="flex-1 h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
              />
              <button
                type="submit"
                className="px-5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow active:scale-95 transition"
              >
                + Generar Acceso
              </button>
            </form>

            <div className="flex flex-col gap-2 mt-2">
              {waiters.map(w => (
                <div key={w.id} className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-white">{w.name}</h4>
                    <div className="flex gap-4 mt-1 text-xs text-slate-500">
                      <span>Usuario: <strong className="text-blue-600 dark:text-blue-400 font-mono">{w.username}</strong></span>
                      <span>Contraseña: <strong className="text-emerald-600 dark:text-emerald-400 font-mono">{w.password}</strong></span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteWaiter(w.id)}
                    className="text-xs font-bold text-red-500 hover:text-red-700 p-2"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
              {waiters.length === 0 && (
                <div className="py-8 text-center text-slate-400 text-xs border border-dashed rounded-xl border-slate-300 dark:border-slate-700">
                  No hay camareros dados de alta. Escribe un nombre y pulsa en Generar Acceso.
                </div>
              )}
            </div>
          </div>
        )}

        {/* DISEÑO DEL TICKET */}
        {activeTab === 'ticket' && (
          <form onSubmit={handleSaveTicket} className="flex flex-col gap-4 max-w-xl">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Personalización del Ticket Térmico</h3>
              <p className="text-xs text-slate-500">Ajusta el texto para que la impresora imprima nítido en negro puro.</p>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Encabezado (Nombre, CIF, Dirección, Teléfono)</label>
              <textarea
                rows={4}
                value={ticketConfig.header}
                onChange={e => setTicketConfig({ ...ticketConfig, header: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-xs font-mono"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Pie de Página (Mensaje de despedida)</label>
              <textarea
                rows={2}
                value={ticketConfig.footer}
                onChange={e => setTicketConfig({ ...ticketConfig, footer: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent text-xs font-mono"
              />
            </div>

            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="showTax"
                checked={ticketConfig.showTax}
                onChange={e => setTicketConfig({ ...ticketConfig, showTax: e.target.checked })}
                className="rounded"
              />
              <label htmlFor="showTax" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Imprimir desglose de IVA (10%)
              </label>
            </div>

            <button
              type="submit"
              className="w-fit px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow mt-2 active:scale-95 transition"
            >
              Guardar Configuración del Ticket
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
SETTINGS_EOF

echo "=== 5. Inyectando detección automática Móvil (Camarero) vs Caja en App.tsx ==="
cat << 'APP_EOF' > src/App.tsx
import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { PosTerminalPro } from './pages/PosTerminalPro';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';

// Componente para detectar el dispositivo en la raíz
function DeviceRouter() {
  const navigate = useNavigate();

  useEffect(() => {
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    const isWaiterLoggedIn = localStorage.getItem('pos_active_waiter');

    if (isMobileDevice) {
      if (isWaiterLoggedIn) {
        navigate('/waiter');
      } else {
        navigate('/auth?role=waiter');
      }
    } else {
      navigate('/app');
    }
  }, [navigate]);

  return (
    <div className="h-dvh w-full flex items-center justify-center bg-slate-900 text-white text-xs">
      Iniciando MOZONA TPV...
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
APP_EOF

echo "=== 6. Compilando y desplegando cambios a producción ==="
npm run build
git add .
git commit -m "feat(pos): boton unico cobrar con vaciado 6s, impresion nitida, generador de camareros cloud y router por dispositivo"
git push origin main

echo "✅ ¡Todo configurado, compilado y desplegado con éxito!"
