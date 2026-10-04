#!/bin/bash
set -e

echo "=== 1. Actualizando ItemsPanel.tsx (Subida de foto / Base64) ==="
cat << 'ITEMS_EOF' > src/components/settings/ItemsPanel.tsx
import React, { useState, useEffect } from 'react';

export function ItemsPanel() {
  const [items, setItems] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category: 'Bebidas',
    image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400'
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('pos_custom_products');
      if (saved) setItems(JSON.parse(saved));
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, image: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.price) return;

    const newItem = {
      id: `custom_${Date.now()}`,
      name: formData.name.trim(),
      price: parseFloat(formData.price),
      category: formData.category,
      image: formData.image
    };

    const updated = [newItem, ...items];
    setItems(updated);
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
    setIsModalOpen(false);
    setFormData({ name: '', price: '', category: 'Bebidas', image: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400' });
  };

  const handleDelete = (id: string) => {
    const updated = items.filter(it => it.id !== id);
    setItems(updated);
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Gestión de Artículos</h2>
          <p className="text-xs text-slate-500">Añade artículos con su foto para verlos en el TPV</p>
        </div>
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow active:scale-95 transition"
        >
          + Nuevo Artículo
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2">
        {items.map(item => (
          <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 flex flex-col justify-between shadow-sm">
            <img src={item.image} alt={item.name} className="w-full h-24 object-cover rounded-lg mb-2" />
            <div className="flex justify-between items-start mb-2">
              <div>
                <h4 className="text-xs font-bold text-slate-800 dark:text-white line-clamp-1">{item.name}</h4>
                <span className="text-[11px] text-slate-400">{item.category}</span>
              </div>
              <span className="text-xs font-black text-blue-600 dark:text-blue-400">{Number(item.price).toFixed(2)}€</span>
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
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-3">Nuevo Artículo</h3>
            <form onSubmit={handleSave} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <img src={formData.image} alt="Preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700" />
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Elegir foto del móvil / PC</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageFile}
                    className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/40 dark:file:text-blue-200"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej. Coca Cola 33cl"
                  className="w-full h-9 px-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Precio (€)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.price}
                    onChange={e => setFormData({ ...formData, price: e.target.value })}
                    placeholder="2.00"
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
                    <option value="Bebidas">Bebidas</option>
                    <option value="Entrantes">Entrantes</option>
                    <option value="Carne">Carne</option>
                    <option value="Pescado">Pescado</option>
                    <option value="Pizza">Pizza</option>
                    <option value="Pasta">Pasta</option>
                    <option value="Postres">Postres</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-bold text-slate-500 hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold"
                >
                  Guardar
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

echo "=== 2. Actualizando CatalogPanel.tsx para mostrar los productos creados en el menú ==="
cat << 'CATALOG_EOF' > src/components/pos/CatalogPanel.tsx
import React, { useRef, useState, useEffect } from 'react';

export function CatalogPanel(props: any) {
  const categoriesRef = useRef<HTMLDivElement>(null);
  const [customProducts, setCustomProducts] = useState<any[]>([]);

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem('pos_custom_products');
        if (raw) setCustomProducts(JSON.parse(raw));
      } catch (err) {
        console.error(err);
      }
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const scrollCats = (dir: 'left' | 'right') => {
    if (categoriesRef.current) {
      categoriesRef.current.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
    }
  };

  const baseList = props.products || [];
  const allList = [...customProducts, ...baseList];

  const filtered = allList.filter((p: any) => {
    const activeCat = props.selectedCategory || 'all';
    const matchesCat = activeCat === 'all' || activeCat === 'Todo' || p.category?.toLowerCase() === activeCat.toLowerCase();
    const matchesQuery = !props.searchQuery || p.name?.toLowerCase().includes(props.searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  const categories = props.categories || [
    { id: 'all', name: 'Todo' },
    { id: 'Entrantes', name: 'Entrantes' },
    { id: 'Carne', name: 'Carne' },
    { id: 'Pescado', name: 'Pescado' },
    { id: 'Pizza', name: 'Pizza' },
    { id: 'Pasta', name: 'Pasta' },
    { id: 'Bebidas', name: 'Bebidas' },
    { id: 'Postres', name: 'Postres' }
  ];

  return (
    <div className="w-full h-full flex flex-col p-2 overflow-hidden">
      {/* Selector de Categorías y Buscador */}
      <div className="shrink-0 flex items-center gap-1.5 mb-2.5">
        <button
          type="button"
          onClick={() => scrollCats('left')}
          className="h-8 w-8 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 flex items-center justify-center text-xs font-bold active:scale-95"
        >
          ◀
        </button>

        <div ref={categoriesRef} className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth">
          {categories.map((cat: any) => {
            const isSelected = (props.selectedCategory || 'all') === cat.id || (props.selectedCategory === 'all' && cat.name === 'Todo');
            return (
              <button
                key={cat.id || cat.name}
                type="button"
                onClick={() => props.onSelectCategory?.(cat.id || cat.name)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {cat.name}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => scrollCats('right')}
          className="h-8 w-8 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 flex items-center justify-center text-xs font-bold active:scale-95"
        >
          ▶
        </button>

        <input
          type="text"
          value={props.searchQuery || ''}
          onChange={e => props.onSearchChange?.(e.target.value)}
          placeholder="Buscar plato..."
          className="w-36 sm:w-44 h-8 text-xs px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent ml-1"
        />
      </div>

      {/* Grid de Platos */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 p-1 content-start flex-1 overflow-y-auto min-h-0">
        {filtered.map((product: any) => (
          <article
            key={product.id}
            onClick={() => props.onAddProduct?.(product)}
            className="w-full rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2 flex flex-col justify-between shadow-sm hover:shadow-md transition cursor-pointer select-none active:scale-98"
          >
            <div className="relative w-full h-24 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
              <img
                src={product.image_url || product.image}
                alt={product.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[11px] font-bold px-1.5 py-0.5 rounded shadow">
                {Number(product.price).toFixed(2)} €
              </span>
            </div>

            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 mt-1.5 leading-tight">
              {product.name}
            </h4>
          </article>
        ))}
      </div>
    </div>
  );
}
CATALOG_EOF

echo "=== 3. Compilando y subiendo a GitHub ==="
npm run build
git add src/components/settings/ItemsPanel.tsx src/components/pos/CatalogPanel.tsx
git commit -m "feat: subida de foto real y conexion directa de articulos al catalogo"
git push origin main

echo "✅ Listo. Recarga la web y prueba a subir un artículo con foto."
