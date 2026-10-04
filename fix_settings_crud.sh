#!/bin/bash
set -e

echo "=== 1. Creando ItemsPanel.tsx funcional con modal ==="
cat << 'ITEMS_EOF' > src/components/settings/ItemsPanel.tsx
import React, { useState, useEffect } from 'react';

interface ProductItem {
  id: string;
  name: string;
  price: number;
  category: string;
  image: string;
}

export function ItemsPanel() {
  const [items, setItems] = useState<ProductItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category: 'Entrantes',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300'
  });

  useEffect(() => {
    const saved = localStorage.getItem('pos_custom_products');
    if (saved) {
      try {
        setItems(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.price) return;

    const newItem: ProductItem = {
      id: `prod_${Date.now()}`,
      name: formData.name,
      price: parseFloat(formData.price),
      category: formData.category,
      image: formData.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300'
    };

    const updated = [newItem, ...items];
    setItems(updated);
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
    setIsModalOpen(false);
    setFormData({ name: '', price: '', category: 'Entrantes', image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=300' });
  };

  const handleDelete = (id: string) => {
    const updated = items.filter(it => it.id !== id);
    setItems(updated);
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Gestión de Artículos</h2>
          <p className="text-xs text-slate-500">Añade platos y bebidas al catálogo del TPV</p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow transition"
        >
          + Nuevo Artículo
        </button>
      </div>

      {/* Grid de artículos añadidos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
        {items.map(item => (
          <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 flex flex-col justify-between shadow-sm">
            <img src={item.image} alt={item.name} className="w-full h-24 object-cover rounded-lg mb-2" />
            <div className="flex justify-between items-start mb-2">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-white line-clamp-1">{item.name}</h4>
                <span className="text-[11px] text-slate-400">{item.category}</span>
              </div>
              <span className="text-xs font-black text-blue-600 dark:text-blue-400">{item.price.toFixed(2)}€</span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(item.id)}
              className="w-full py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition"
            >
              Eliminar
            </button>
          </div>
        ))}
        {items.length === 0 && (
          <div className="col-span-full py-8 text-center text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
            No hay artículos personalizados creados. Pulsa en "+ Nuevo Artículo" para registrar el primero.
          </div>
        )}
      </div>

      {/* Modal Formulario Nuevo Artículo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-3">Nuevo Artículo</h3>
            <form onSubmit={handleSave} className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Nombre del plato o bebida</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej. Hamburguesa Especial"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Precio (€ IVA inc.)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.price}
                    onChange={e => setFormData({ ...formData, price: e.target.value })}
                    placeholder="0.00"
                    className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Categoría</label>
                  <select
                    value={formData.category}
                    onChange={e => setFormData({ ...formData, category: e.target.value })}
                    className="w-full h-9 px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
                  >
                    <option value="Entrantes">Entrantes</option>
                    <option value="Carne">Carne</option>
                    <option value="Pescado">Pescado</option>
                    <option value="Pizza">Pizza</option>
                    <option value="Bebidas">Bebidas</option>
                    <option value="Postres">Postres</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">URL de la Imagen</label>
                <input
                  type="url"
                  value={formData.image}
                  onChange={e => setFormData({ ...formData, image: e.target.value })}
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-xs"
                />
              </div>
              <div className="flex gap-2 justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                >
                  Guardar Artículo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
ITEMS_EOF

echo "=== 2. Creando TablesPanel.tsx funcional ==="
cat << 'TABLES_EOF' > src/components/settings/TablesPanel.tsx
import React, { useState, useEffect } from 'react';

export function TablesPanel() {
  const [tablesCount, setTablesCount] = useState<number>(16);

  useEffect(() => {
    const saved = localStorage.getItem('pos_tables_total');
    if (saved) setTablesCount(parseInt(saved, 10));
  }, []);

  const updateCount = (val: number) => {
    const next = Math.max(1, Math.min(32, val));
    setTablesCount(next);
    localStorage.setItem('pos_tables_total', next.toString());
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Configuración de Mesas</h2>
        <p className="text-xs text-slate-500">Define el número de mesas disponibles en sala</p>
      </div>

      <div className="flex items-center gap-3 bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 max-w-sm">
        <span className="text-sm font-semibold">Total de Mesas:</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateCount(tablesCount - 1)}
            className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold"
          >
            -
          </button>
          <span className="text-base font-black px-2">{tablesCount}</span>
          <button
            type="button"
            onClick={() => updateCount(tablesCount + 1)}
            className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 font-bold"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
TABLES_EOF

echo "=== 3. Creando CategoriesPanel.tsx funcional ==="
cat << 'CATS_EOF' > src/components/settings/CategoriesPanel.tsx
import React, { useState, useEffect } from 'react';

export function CategoriesPanel() {
  const [categories, setCategories] = useState<string[]>(['Entrantes', 'Carne', 'Pescado', 'Pizza', 'Pasta', 'Bebidas']);
  const [newCat, setNewCat] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('pos_custom_categories');
    if (saved) {
      try {
        setCategories(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    const updated = [...categories, newCat.trim()];
    setCategories(updated);
    localStorage.setItem('pos_custom_categories', JSON.stringify(updated));
    setNewCat('');
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Gestión de Categorías</h2>
        <p className="text-xs text-slate-500">Organiza los grupos de productos</p>
      </div>

      <form onSubmit={handleAdd} className="flex gap-2 max-w-md">
        <input
          type="text"
          value={newCat}
          onChange={e => setNewCat(e.target.value)}
          placeholder="Nueva categoría (ej. Postres)"
          className="flex-1 h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
        />
        <button type="submit" className="px-4 bg-blue-600 text-white font-bold text-xs rounded-lg">
          + Añadir
        </button>
      </form>

      <div className="flex flex-wrap gap-2 mt-2">
        {categories.map((cat, idx) => (
          <span key={idx} className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold shadow-sm">
            {cat}
          </span>
        ))}
      </div>
    </div>
  );
}
CATS_EOF

echo "=== 4. Reemplazando SettingsPage.tsx para conectar las pestañas ==="
cat << 'SETTINGS_EOF' > src/pages/SettingsPage.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ItemsPanel } from '../components/settings/ItemsPanel';
import { TablesPanel } from '../components/settings/TablesPanel';
import { CategoriesPanel } from '../components/settings/CategoriesPanel';

export function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'articulos' | 'mesas' | 'categorias'>('articulos');

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
            <p className="text-xs text-slate-500">Administración de cartas, mesas y familias</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 mb-4">
        <button
          type="button"
          onClick={() => setActiveTab('articulos')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
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
          className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
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
          className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
            activeTab === 'categorias'
              ? 'bg-blue-600 text-white shadow'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          Categorías
        </button>
      </div>

      {/* Contenido activo */}
      <div className="bg-white dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex-1 shadow-sm">
        {activeTab === 'articulos' && <ItemsPanel />}
        {activeTab === 'mesas' && <TablesPanel />}
        {activeTab === 'categorias' && <CategoriesPanel />}
      </div>
    </div>
  );
}

export default SettingsPage;
SETTINGS_EOF

echo "=== 5. Compilando y subiendo a GitHub ==="
npm run build
git add src/components/settings/ src/pages/SettingsPage.tsx
git commit -m "feat(settings): conectar modales y formularios funcionales de articulos mesas y categorias"
git push origin main

echo "✅ ¡Configuración 100% activa y desplegada!"
