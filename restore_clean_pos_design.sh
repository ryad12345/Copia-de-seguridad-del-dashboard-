#!/bin/bash
set -e

echo "=== Restaurando diseño original pulido de CatalogPanel.tsx ==="
cat << 'CATALOG_EOF' > src/components/pos/CatalogPanel.tsx
import React, { useRef, useState, useEffect } from 'react';

const FALLBACK_IMG = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";

export function CatalogPanel(props: any) {
  const categoriesRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [productsList, setProductsList] = useState<any[]>(props.products || []);
  const [internalCategory, setInternalCategory] = useState<string>('all');

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem("pos_custom_products_chalohiahmd1980@gmail.com") || localStorage.getItem('pos_custom_products');
        if (raw) {
          setProductsList(JSON.parse(raw));
        } else if (props.products && props.products.length > 0) {
          setProductsList(props.products);
        }
      } catch (err) {
        console.error(err);
      }
    };
    sync();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [props.products]);

  const activeCategory = props.selectedCategory !== undefined ? props.selectedCategory : internalCategory;

  const handleCategoryClick = (catVal: string) => {
    setInternalCategory(catVal);
    if (typeof props.onSelectCategory === 'function') {
      props.onSelectCategory(catVal);
    }
  };

  const scrollCats = (dir: 'left' | 'right') => {
    if (categoriesRef.current) {
      categoriesRef.current.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
    }
  };

  const scrollGrid = (dir: 'up' | 'down') => {
    if (gridContainerRef.current) {
      gridContainerRef.current.scrollBy({ top: dir === 'up' ? -220 : 220, behavior: 'smooth' });
    }
  };

  const filtered = productsList.filter((product: any) => {
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
    { id: 'Pasta', name: 'Pasta' },
    { id: 'Pizza', name: 'Pizza' },
    { id: 'Extras', name: 'Extras' },
    { id: 'Postres', name: 'Postres' },
    { id: 'Bebidas', name: 'Bebidas' }
  ];

  return (
    <div className="relative w-full h-full flex flex-col p-2 bg-slate-50/50 dark:bg-slate-900/50 rounded-xl overflow-hidden">
      {/* Barra de Categorías Horizontal */}
      <div className="shrink-0 flex items-center gap-1 mb-2">
        <button
          type="button"
          onClick={() => scrollCats('left')}
          className="h-8 w-8 shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold active:scale-95 transition shadow-sm"
        >
          ◀
        </button>

        <div
          ref={categoriesRef}
          className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth items-center"
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
                className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 shadow-sm whitespace-nowrap ${
                  isSelected
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
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
          className="h-8 w-8 shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold active:scale-95 transition shadow-sm"
        >
          ▶
        </button>

        <input
          type="text"
          value={props.searchQuery || ''}
          onChange={e => props.onSearchChange?.(e.target.value)}
          placeholder="Buscar..."
          className="w-28 sm:w-36 h-8 text-xs px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 ml-1"
        />
      </div>

      {/* Grid de Platos Original Compacto */}
      <div
        ref={gridContainerRef}
        className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-2 content-start flex-1 overflow-y-auto min-h-0 scroll-smooth pr-12 pb-2"
      >
        {filtered.map((product: any) => (
          <article
            key={product.id}
            onClick={() => props.onAddProduct?.(product)}
            className="w-full rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1.5 flex flex-col justify-between shadow-sm hover:border-blue-400 transition cursor-pointer select-none active:scale-95"
          >
            <div className="relative w-full h-20 shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
              <img
                src={product.image || product.image_url || FALLBACK_IMG}
                alt={product.name}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e: any) => {
                  e.target.onerror = null;
                  e.target.src = FALLBACK_IMG;
                }}
              />
              <span className="absolute bottom-1 left-1 bg-slate-900/90 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow">
                {Number(product.price).toFixed(2)} €
              </span>
            </div>

            <div className="mt-1 flex flex-col justify-between flex-1">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-1 leading-tight">
                {product.name}
              </h4>
              <span className="text-[10px] text-slate-400 truncate">
                {product.description || product.category}
              </span>
            </div>
          </article>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400 text-xs font-semibold">
            No hay platos en esta categoría.
          </div>
        )}
      </div>

      {/* Botones Flotantes de Scroll */}
      <div className="absolute right-2 bottom-2 flex flex-col gap-1.5 z-20">
        <button
          type="button"
          onClick={() => scrollGrid('up')}
          className="w-9 h-9 bg-slate-900/80 hover:bg-slate-900 text-white dark:bg-slate-700/80 rounded-lg shadow flex items-center justify-center text-xs font-black active:scale-90 transition backdrop-blur-sm"
          title="Subir"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => scrollGrid('down')}
          className="w-9 h-9 bg-slate-900/80 hover:bg-slate-900 text-white dark:bg-slate-700/80 rounded-lg shadow flex items-center justify-center text-xs font-black active:scale-90 transition backdrop-blur-sm"
          title="Bajar"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

export default CatalogPanel;
CATALOG_EOF

echo "=== Compilando y desplegando ==="
npm run build
git add src/components/pos/CatalogPanel.tsx
git commit -m "style(catalog): restaurar diseno original compacto y alineacion con el TPV"
git push origin main

echo "✅ ¡Listo! Diseño original restaurado en producción."
