#!/bin/bash
set -e

echo "=== Configurando carta oficial exacta con fotos para chalohiahmd1980@gmail.com ==="

cat << 'ITEMS_EOF' > src/components/settings/ItemsPanel.tsx
import React, { useState, useEffect } from 'react';

export interface CustomProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  image: string;
}

export const TARGET_USER_EMAIL = "chalohiahmd1980@gmail.com";

export const RESTAURANT_MENU: CustomProduct[] = [
  // --- ENTRANTES ---
  {
    id: "ent_1",
    name: "Ensalada Rusa",
    description: "Patata, atún, huevo y mayonesa",
    price: 9.00,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500"
  },
  {
    id: "ent_2",
    name: "Ensalada Mixta",
    description: "Lechuga, tomate, cebolla, maíz, atún y aceitunas",
    price: 7.00,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500"
  },
  {
    id: "ent_3",
    name: "Ensalada Griega",
    description: "Tomate, pepino, cebolla, queso feta, aceitunas negras, pimiento verde",
    price: 7.80,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=500"
  },
  {
    id: "ent_4",
    name: "Ensalada marroquí",
    description: "Tomate, cebolla, pepino y pimiento",
    price: 6.80,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500"
  },
  {
    id: "ent_5",
    name: "Ensalada marroquí de berenjenas",
    description: "Berenjenas, tomate, pimiento, ajo y perejil",
    price: 6.50,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1529042410759-befb1204b468?w=500"
  },
  {
    id: "ent_6",
    name: "Gambas al pil pil o al ajillo",
    price: 10.00,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1559742811-822873691df8?w=500"
  },
  {
    id: "ent_7",
    name: "Pulpo a la gallega",
    price: 6.00,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500"
  },
  {
    id: "ent_8",
    name: "Almejas al gusto",
    price: 7.50,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=500"
  },
  {
    id: "ent_9",
    name: "Revuelto de ajetes y gambas",
    price: 8.00,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1525351484163-7529414344d8?w=500"
  },
  {
    id: "ent_10",
    name: "Gambas cocidas o plancha",
    price: 6.95,
    category: "Entrantes",
    image: "https://images.unsplash.com/photo-1565680018434-b513d5e5fd47?w=500"
  },

  // --- CARNE ---
  {
    id: "car_1",
    name: "Tajen de pollo",
    price: 8.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1541518763669-27fef04b14ea?w=500"
  },
  {
    id: "car_2",
    name: "Tajen de ternera",
    price: 10.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1544025162-d76694265947?w=500"
  },
  {
    id: "car_3",
    name: "Tajen de cordero",
    price: 17.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1574484284002-952d92456975?w=500"
  },
  {
    id: "car_4",
    name: "Tajen de carne picada (kefta)",
    price: 10.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=500"
  },
  {
    id: "car_5",
    name: "Plato de pinchitos",
    description: "Con arroz, patatas fritas o ensalada",
    price: 8.50,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500"
  },
  {
    id: "car_6",
    name: "Pollo asado con patatas fritas",
    price: 16.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=500"
  },
  {
    id: "car_7",
    name: "Pollo asado con patatas fritas (1/2)",
    price: 8.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=500"
  },
  {
    id: "car_8",
    name: "Alitas de pollo",
    price: 6.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=500"
  },
  {
    id: "car_9",
    name: "Menú de kebab",
    price: 7.50,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1561651823-34feb02250e4?w=500"
  },
  {
    id: "car_10",
    name: "Menú de hamburguesa",
    price: 8.00,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500"
  },
  {
    id: "car_11",
    name: "Menú de nuggets de pollo",
    price: 6.95,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1562967914-608f82629710?w=500"
  },
  {
    id: "car_12",
    name: "Pastela de pollo",
    price: 7.50,
    category: "Carne",
    image: "https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500"
  },

  // --- PESCADO ---
  {
    id: "pes_1",
    name: "Tajen de pescado",
    price: 11.00,
    category: "Pescado",
    image: "https://images.unsplash.com/photo-1534939561126-855b8675edd7?w=500"
  },
  {
    id: "pes_2",
    name: "Pastela de pescado",
    price: 8.80,
    category: "Pescado",
    image: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=500"
  },
  {
    id: "pes_3",
    name: "Dorada a la plancha",
    price: 15.00,
    category: "Pescado",
    image: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=500"
  },
  {
    id: "pes_4",
    name: "Calamares fritos",
    price: 12.00,
    category: "Pescado",
    image: "https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?w=500"
  },
  {
    id: "pes_5",
    name: "Rosada a la plancha",
    price: 12.50,
    category: "Pescado",
    image: "https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=500"
  },

  // --- PASTA ---
  {
    id: "pas_1",
    name: "Espagueti a la boloñesa",
    price: 13.00,
    category: "Pasta",
    image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=500"
  },
  {
    id: "pas_2",
    name: "Espagueti salmón",
    price: 13.00,
    category: "Pasta",
    image: "https://images.unsplash.com/photo-1621996346565-e3adc6d7d0fa?w=500"
  },
  {
    id: "pas_3",
    name: "Espagueti fruta del mar",
    price: 13.50,
    category: "Pasta",
    image: "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=500"
  },

  // --- PIZZA ---
  {
    id: "piz_1",
    name: "Margarita",
    description: "Tomate y queso",
    price: 7.00,
    category: "Pizza",
    image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500"
  },
  {
    id: "piz_2",
    name: "Siciliana",
    description: "Tomate, queso, atún, cebolla y aceituna",
    price: 7.00,
    category: "Pizza",
    image: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=500"
  },
  {
    id: "piz_3",
    name: "La casa",
    description: "Tomate, queso y chawarma",
    price: 8.00,
    category: "Pizza",
    image: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=500"
  },
  {
    id: "piz_4",
    name: "Boloñesa",
    description: "Tomate, queso y carne picada",
    price: 8.00,
    category: "Pizza",
    image: "https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?w=500"
  },

  // --- EXTRAS ---
  {
    id: "ext_1",
    name: "Patatas fritas",
    price: 3.00,
    category: "Extras",
    image: "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=500"
  },
  {
    id: "ext_2",
    name: "Verduras salteadas",
    price: 2.50,
    category: "Extras",
    image: "https://images.unsplash.com/photo-1546069901-d5bfd2cbfb1f?w=500"
  },
  {
    id: "ext_3",
    name: "Arroz",
    price: 2.50,
    category: "Extras",
    image: "https://images.unsplash.com/photo-1516684732162-798a0062be99?w=500"
  },
  {
    id: "ext_4",
    name: "Salsa",
    price: 0.50,
    category: "Extras",
    image: "https://images.unsplash.com/photo-1472476443507-c7a5948772fc?w=500"
  },

  // --- POSTRES Y BEBIDAS ---
  {
    id: "pos_1",
    name: "Flan casero",
    price: 3.00,
    category: "Postres",
    image: "https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=500"
  },
  {
    id: "pos_2",
    name: "Tarta de queso",
    price: 7.00,
    category: "Postres",
    image: "https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500"
  },
  {
    id: "pos_3",
    name: "Dulces árabes",
    price: 1.00,
    category: "Postres",
    image: "https://images.unsplash.com/photo-1579372786545-d24232daf58c?w=500"
  },
  {
    id: "pos_4",
    name: "Helados",
    price: 5.00,
    category: "Postres",
    image: "https://images.unsplash.com/photo-1497034825429-c343d7c6a68f?w=500"
  },
  {
    id: "pos_5",
    name: "Café",
    price: 1.50,
    category: "Bebidas",
    image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=500"
  },
  {
    id: "pos_6",
    name: "Té marroquí",
    price: 2.50,
    category: "Bebidas",
    image: "https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=500"
  }
];

export function ItemsPanel() {
  const [items, setItems] = useState<CustomProduct[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CustomProduct | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    category: 'Entrantes',
    image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500'
  });

  const STORAGE_KEY = `pos_custom_products_${TARGET_USER_EMAIL}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setItems(JSON.parse(saved));
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(RESTAURANT_MENU));
        localStorage.setItem('pos_custom_products', JSON.stringify(RESTAURANT_MENU));
        setItems(RESTAURANT_MENU);
        window.dispatchEvent(new Event('storage'));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const openNewModal = () => {
    setEditingItem(null);
    setFormData({
      name: '',
      price: '',
      category: 'Entrantes',
      image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?w=500'
    });
    setIsModalOpen(true);
  };

  const openEditModal = (item: CustomProduct) => {
    setEditingItem(item);
    setFormData({
      name: item.name,
      price: item.price.toString(),
      category: item.category,
      image: item.image
    });
    setIsModalOpen(true);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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

    let updated: CustomProduct[];
    if (editingItem) {
      updated = items.map(it =>
        it.id === editingItem.id
          ? {
              ...it,
              name: formData.name.trim(),
              price: parseFloat(formData.price),
              category: formData.category,
              image: formData.image
            }
          : it
      );
    } else {
      const newItem: CustomProduct = {
        id: `prod_${Date.now()}`,
        name: formData.name.trim(),
        price: parseFloat(formData.price),
        category: formData.category,
        image: formData.image
      };
      updated = [newItem, ...items];
    }

    setItems(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
    setIsModalOpen(false);
  };

  const handleDelete = (id: string) => {
    const updated = items.filter(it => it.id !== id);
    setItems(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    localStorage.setItem('pos_custom_products', JSON.stringify(updated));
    window.dispatchEvent(new Event('storage'));
  };

  const handleResetMenu = () => {
    if (confirm('¿Restaurar todo el menú original con sus fotos y precios exactos?')) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(RESTAURANT_MENU));
      localStorage.setItem('pos_custom_products', JSON.stringify(RESTAURANT_MENU));
      setItems(RESTAURANT_MENU);
      window.dispatchEvent(new Event('storage'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Menú Oficial ({TARGET_USER_EMAIL})</h2>
          <p className="text-xs text-slate-500">Total: {items.length} platos y bebidas configurados</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleResetMenu}
            className="px-3.5 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-white font-bold text-xs rounded-xl transition active:scale-95"
          >
            Restaurar Menú Oficial
          </button>
          <button
            type="button"
            onClick={openNewModal}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow active:scale-95 transition"
          >
            + Nuevo Artículo
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-2">
        {items.map(item => (
          <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 flex flex-col justify-between shadow-sm">
            <img src={item.image} alt={item.name} className="w-full h-24 object-cover rounded-lg mb-2 bg-slate-100 dark:bg-slate-700" />
            <div className="flex justify-between items-start mb-2">
              <div className="flex-1 min-w-0 pr-1">
                <h4 className="text-xs font-bold text-slate-800 dark:text-white line-clamp-1" title={item.name}>{item.name}</h4>
                <span className="text-[11px] text-slate-400">{item.category}</span>
              </div>
              <span className="text-xs font-black text-blue-600 dark:text-blue-400 whitespace-nowrap">{Number(item.price).toFixed(2)} €</span>
            </div>
            <div className="grid grid-cols-2 gap-1 pt-1 border-t border-slate-100 dark:border-slate-700">
              <button
                type="button"
                onClick={() => openEditModal(item)}
                className="py-1 text-[11px] font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => handleDelete(item.id)}
                className="py-1 text-[11px] font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg transition"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 dark:text-white mb-3">
              {editingItem ? 'Editar Artículo' : 'Nuevo Artículo'}
            </h3>
            <form onSubmit={handleSave} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <img src={formData.image} alt="Preview" className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-slate-700" />
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-500 block mb-1">Subir Foto</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/40 dark:file:text-blue-200 cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">Nombre del Plato / Bebida</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej. Tajen de cordero"
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
                    placeholder="17.00"
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
                    <option value="Pasta">Pasta</option>
                    <option value="Pizza">Pizza</option>
                    <option value="Extras">Extras</option>
                    <option value="Postres">Postres</option>
                    <option value="Bebidas">Bebidas</option>
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

export default ItemsPanel;
ITEMS_EOF

echo "=== Actualizando CatalogPanel.tsx para incluir todas las categorías y cargar la carta ==="
cat << 'CATALOG_EOF' > src/components/pos/CatalogPanel.tsx
import React, { useRef, useState, useEffect } from 'react';
import { RESTAURANT_MENU, TARGET_USER_EMAIL } from '../settings/ItemsPanel';

export function CatalogPanel(props: any) {
  const categoriesRef = useRef<HTMLDivElement>(null);
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [productsList, setProductsList] = useState<any[]>(RESTAURANT_MENU);
  const [internalCategory, setInternalCategory] = useState<string>('all');

  const STORAGE_KEY = `pos_custom_products_${TARGET_USER_EMAIL}`;

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('pos_custom_products');
        if (raw) {
          setProductsList(JSON.parse(raw));
        } else {
          setProductsList(RESTAURANT_MENU);
        }
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

  const scrollCats = (direction: 'left' | 'right') => {
    if (categoriesRef.current) {
      const offset = direction === 'left' ? -220 : 220;
      categoriesRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  const scrollGrid = (direction: 'up' | 'down') => {
    if (gridContainerRef.current) {
      const offset = direction === 'up' ? -260 : 260;
      gridContainerRef.current.scrollBy({ top: offset, behavior: 'smooth' });
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
    <div className="relative w-full h-full flex flex-col p-2 overflow-hidden bg-white dark:bg-slate-800 rounded-xl">
      {/* 1. Barra de Categorías Horizontal con Botones ◀ y ▶ */}
      <div className="shrink-0 flex items-center gap-1.5 mb-2 pb-1 border-b border-slate-100 dark:border-slate-700">
        <button
          type="button"
          onClick={() => scrollCats('left')}
          className="h-9 w-9 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 flex items-center justify-center text-sm font-bold active:scale-95 transition shadow-sm"
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

      {/* 2. Grid de platos con scroll vertical */}
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
                src={product.image}
                alt={product.name}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-1 left-1 bg-black/80 text-white text-[11px] font-black px-2 py-0.5 rounded shadow">
                {Number(product.price).toFixed(2)} €
              </span>
            </div>

            <div className="mt-1.5 flex flex-col justify-between flex-1">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2 leading-tight">
                {product.name}
              </h4>
              {product.description && (
                <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5">{product.description}</p>
              )}
            </div>
          </article>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400 text-xs font-semibold">
            No hay platos disponibles en esta categoría.
          </div>
        )}
      </div>

      {/* 3. Botones Flotantes Subir / Bajar */}
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

echo "=== Compilando y desplegando ==="
npm run build
git add src/components/settings/ItemsPanel.tsx src/components/pos/CatalogPanel.tsx
git commit -m "feat(menu): inyectar carta completa exacta con fotos para chalohiahmd1980@gmail.com"
git push origin main

echo "✅ ¡Listo! La carta física completa ya está disponible en la app."
