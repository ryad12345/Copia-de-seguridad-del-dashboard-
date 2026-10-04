#!/bin/bash
set -e

echo "=== Actualizando SettingsPage.tsx con los tipos y props necesarios ==="
cat << 'SETTINGS_EOF' > src/pages/SettingsPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemsPanel } from '../components/settings/ItemsPanel';
import { TablesPanel } from '../components/settings/TablesPanel';
import { CategoriesPanel } from '../components/settings/CategoriesPanel';

export interface RestaurantForm {
  name?: string;
  nif?: string;
  address?: string;
  phone?: string;
  ticketHeader?: string;
  ticketFooter?: string;
  [key: string]: any;
}

export interface SettingsPageProps {
  initial?: RestaurantForm;
  onSave?: (data: RestaurantForm) => void;
}

export function SettingsPage({ initial, onSave }: SettingsPageProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'articulos' | 'mesas' | 'categorias' | 'general'>('articulos');
  const [formData, setFormData] = useState<RestaurantForm>(initial || {});

  const handleGeneralSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSave) onSave(formData);
  };

  return (
    <div className="min-h-screen w-full bg-slate-100 dark:bg-slate-900 flex flex-col p-4 sm:p-6">
      {/* Cabecera */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800 mb-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate('/app')}
            className="h-10 px-4 bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-white font-bold text-xs rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 flex items-center gap-2 transition active:scale-95"
          >
            ⬅ VOLVER AL TPV
          </button>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Configuración</h1>
            <p className="text-xs text-slate-500">Administración de cartas, mesas, familias y datos de negocio</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 mb-4 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('articulos')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
            activeTab === 'articulos'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          Artículos (Platos y Bebidas)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('mesas')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
            activeTab === 'mesas'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          Mesas
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categorias')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
            activeTab === 'categorias'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          Categorías
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('general')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
            activeTab === 'general'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          General / Ticket
        </button>
      </div>

      {/* Contenido activo */}
      <div className="bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex-1 shadow-sm">
        {activeTab === 'articulos' && <ItemsPanel />}
        {activeTab === 'mesas' && <TablesPanel />}
        {activeTab === 'categorias' && <CategoriesPanel />}
        {activeTab === 'general' && (
          <form onSubmit={handleGeneralSave} className="flex flex-col gap-4 max-w-lg">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">Nombre del Negocio</label>
              <input
                type="text"
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">NIF / CIF</label>
              <input
                type="text"
                value={formData.nif || ''}
                onChange={e => setFormData({ ...formData, nif: e.target.value })}
                className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
              />
            </div>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold w-fit">
              Guardar Datos
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default SettingsPage;
SETTINGS_EOF

echo "=== Compilando y desplegando ==="
npm run build
git add src/pages/SettingsPage.tsx
git commit -m "fix(types): exportar RestaurantForm y aceptar props en SettingsPage"
git push origin main

echo "✅ Compilación exitosa y subida realizada."
