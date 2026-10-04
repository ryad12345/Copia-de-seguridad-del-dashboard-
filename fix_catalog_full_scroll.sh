#!/bin/bash
set -e

echo "=== Actualizando src/components/pos/CatalogPanel.tsx con Scroll Vertical y Horizontal ==="
cat << 'CATALOG_EOF' > src/components/pos/CatalogPanel.tsx
import React, { useRef, useState, useEffect } from 'react';

export function CatalogPanel(props: any) {
  const categoriesRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [customProducts, setCustomProducts] = useState<any[]>([]);
  const [internalCategory, setInternalCategory] = useState<string>('all');

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

  const activeCategory = props.selectedCategory !== undefined ? props.selectedCategory : internalCategory;

  const handleCategoryClick = (catVal: string) => {
    setInternalCategory(catVal);
    if (typeof props.onSelectCategory === 'function') {
      props.onSelectCategory(catVal);
    }
  };

  // Scroll horizontal en la barra de categorías
  const scrollCats = (direction: 'left' | 'right') => {
    if (categoriesRef.current) {
      const offset = direction === 'left' ? -220 : 220;
      categoriesRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  // Scroll vertical en la cuadrícula de platos
  const scrollGrid = (direction: 'up' | 'down') => {
    if (gridContainerRef.current) {
      const offset = direction === 'up' ? -260 : 260;
      gridContainerRef.current.scrollBy({ top: offset, behavior: 'smooth' });
    }
  };

  const baseList = props.products || [];
  const allList = [...customProducts, ...baseList];

  const filtered = allList.filter((product: any) => {
    const isAll = !activeCategory || activeCategory === 'all' || activeCategory === 'Todo';
    const productCat = (product.category || product.category_id || '').toString().toLowerCase();
    const currentCat = activeCategory.toString().toLowerCase();
    const matchesCategory = isAll || productCat === currentCat;

    const searchQuery = (props.searchQuery || '').trim().toLowerCase();
    const matchesSearch = !searchQuery || (product.name || '').toLowerCase().includes(searchQuery);

    return matchesCategory && matchesSearch;
  });

  const categoryList = [
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
    <div className="relative w-full h-full flex flex-col p-2 overflow-hidden bg-white dark:bg-slate-800 rounded-xl">
      {/* 1. Barra de Categorías Horizontal con Flechas ◀ y ▶ */}
      <div className="shrink-0 flex items-center gap-1.5 mb-2 pb-1 border-b border-slate-100 dark:border-slate-700">
        <button
          type="button"
          onClick={() => scrollCats('left')}
          className="h-9 w-9 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-sm font-bold active:scale-95 transition shadow-sm"
          title="Desplazar categorías a la izquierda"
        >
          ◀
        </button>

        <div
          ref={categoriesRef}
          className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar py-1 scroll-smooth items-center"
        >
          {categoryList.map(cat => {
            const isSelected =
              activeCategory === cat.id ||
              (activeCategory === 'all' && cat.id === 'all') ||
              activeCategory?.toLowerCase() === cat.name?.toLowerCase();

            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryClick(cat.id)}
                className={`px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition active:scale-95 shadow-sm ${
                  isSelected
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-slate-100 dark:bg-slate-700/60 text-slate-700 dark:text-slate-200 hover:bg-slate-200'
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
          className="h-9 w-9 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-sm font-bold active:scale-95 transition shadow-sm"
          title="Desplazar categorías a la derecha"
        >
          ▶
        </button>

        <input
          type="text"
          value={props.searchQuery || ''}
          onChange={e => props.onSearchChange?.(e.target.value)}
          placeholder="Buscar..."
          className="w-32 sm:w-36 h-9 text-xs px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 ml-1"
        />
      </div>

      {/* 2. Contenedor de la Cuadrícula de Platos con Scroll Vertical */}
      <div
        ref={gridContainerRef}
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 p-1 content-start flex-1 overflow-y-auto min-h-0 scroll-smooth pr-14"
      >
        {filtered.map((product: any) => (
          <article
            key={product.id}
            onClick={() => props.onAddProduct?.(product)}
            className="w-full rounded-xl bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-700 p-2 flex flex-col justify-between shadow-sm hover:shadow-md transition cursor-pointer select-none active:scale-95"
          >
            <div className="relative w-full h-24 shrink-0 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700">
              <img
                src={product.image_url || product.image}
                alt={product.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[11px] font-black px-2 py-0.5 rounded shadow">
                {Number(product.price).toFixed(2)} €
              </span>
            </div>

            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 mt-1.5 leading-tight">
              {product.name}
            </h4>
          </article>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400 text-xs font-semibold">
            No hay platos disponibles en esta categoría.
          </div>
        )}
      </div>

      {/* 3. Botones Flotantes Táctiles para Subir y Bajar la Carta */}
      <div className="absolute right-3 bottom-3 flex flex-col gap-2 z-20">
        <button
          type="button"
          onClick={() => scrollGrid('up')}
          className="w-11 h-11 bg-slate-900/90 hover:bg-slate-900 text-white dark:bg-slate-100/90 dark:text-slate-900 rounded-xl shadow-lg flex items-center justify-center text-base font-black active:scale-90 transition backdrop-blur-sm border border-slate-700/30"
          title="Subir carta"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => scrollGrid('down')}
          className="w-11 h-11 bg-slate-900/90 hover:bg-slate-900 text-white dark:bg-slate-100/90 dark:text-slate-900 rounded-xl shadow-lg flex items-center justify-center text-base font-black active:scale-90 transition backdrop-blur-sm border border-slate-700/30"
          title="Bajar carta"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

export default CatalogPanel;
CATALOG_EOF

echo "=== Compilando y subiendo cambios ==="
npm run build
git add src/components/pos/CatalogPanel.tsx
git commit -m "feat(catalog): anadir botones flotantes de scroll vertical y optimizar navegacion tactil"
git push origin main

echo "✅ ¡Listo! Botones de subir/bajar y categorías listos en producción."
