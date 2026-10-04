// CatalogPanel.tsx — Query DIRECTA con JWT + sanitizer
import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { supabaseFetch } from '../../lib/supabase-fetch';
import { sanitizeProductsData } from '../../lib/sync/sync-helpers';
import { useAuth } from '../../context/AuthContext';

const FALLBACK_IMG = "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400";
const STORAGE_KEY = "pos_custom_products_chalohiahmd1980@gmail.com";

function loadFromLS(): any[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch {}
    return [];
}

function saveToLS(products: any[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(products)); } catch {}
}

export function CatalogPanel(props: any) {
    const categoriesRef = useRef<HTMLDivElement>(null);
    const gridContainerRef = useRef<HTMLDivElement>(null);

    const auth = useAuth();
    const tenantId = auth?.tenant?.id || "";
    const sessionJwt = auth?.session?.access_token || null;
    const userEmail = auth?.user?.email || "";

    // 1) Cache LS al montar → pinta instantáneo
    const [products, setProducts] = useState<any[]>(() => loadFromLS());
    const [error, setError] = useState<string | null>(null);
    const [usingJwt, setUsingJwt] = useState(false);

    // 2) Query DIRECTA con JWT del usuario autenticado
    useEffect(() => {
        if (!tenantId || tenantId === "undefined" || tenantId === "00000000-0000-0000-0000-000000000000") {
            return;
        }

        let cancelled = false;

        (async () => {
            try {
                let data: any[] = [];

                if (sessionJwt) {
                    // ★ v4.1.3-RLS-FIX: usar JWT del usuario en headers Authorization.
                    //   El SDK adjunta el anon_key por defecto, lo que hace que
                    //   RLS evalúe la policy con rol 'anon' (que devuelve []).
                    //   Con el JWT del usuario, RLS evalúa 'authenticated' y devuelve datos.
                    console.log("[CatalogPanel] query con JWT de usuario:", userEmail);
                    setUsingJwt(true);

                    const r = await supabaseFetch(
                        `/rest/v1/products?select=id,name,price,category,image_url,is_available,tenant_id&tenant_id=eq.${tenantId}&order=name.asc`,
                        { jwt: sessionJwt }
                    );

                    if (cancelled) return;
                    if (!r.ok) {
                        const errText = await r.text();
                        setError(`HTTP ${r.status}: ${errText}`);
                        return;
                    }
                    data = await r.json();
                } else if (supabase) {
                    // Sin sesión activa: fallback al cliente global (anon key)
                    console.log("[CatalogPanel] sin sesión JWT, usando anon key");
                    setUsingJwt(false);

                    const { data: sbData, error: sbError } = await supabase
                        .from("products")
                        .select("id, name, price, category, image_url, is_available, tenant_id")
                        .eq("tenant_id", tenantId)
                        .order("name");

                    if (cancelled) return;
                    if (sbError) {
                        setError(sbError.message);
                        return;
                    }
                    data = sbData || [];
                } else {
                    setError("Supabase no configurado");
                    return;
                }

                const mapped = (data || []).map((p: any) => ({
                    id: p.id,
                    name: p.name,
                    description: undefined,
                    price: Number(p.price ?? 0),
                    category: p.category ?? "Otros",
                    image: p.image_url ?? FALLBACK_IMG,
                    image_url: p.image_url,
                    is_available: p.is_available ?? true,
                    tenant_id: tenantId,
                }));

                // ★ v4.2.0: sanitizer garantiza category nunca vacía
                const sanitized = sanitizeProductsData(mapped);

                setProducts(sanitized);
                saveToLS(sanitized);
                setError(null);
                console.log(`[CatalogPanel] ${sanitized.length} productos cargados (JWT: ${!!sessionJwt})`);
            } catch (e: any) {
                if (!cancelled) setError(e?.message || String(e));
            }
        })();

        return () => { cancelled = true; };
    }, [tenantId, sessionJwt]);

    // CATEGORÍAS
    const propsCats = Array.isArray(props.categories) ? props.categories : [];
    const categoryList = (() => {
        if (propsCats.length > 0) {
            return [
                { id: "all", name: "Todo" },
                ...propsCats.filter((c: any) => c?.name).map((c: any) => ({ id: c.id ?? c.name, name: c.name }))
            ];
        }
        const dynamicCats = Array.from(
            new Set(products.map((p: any) => (p.category || "").toString().trim()).filter(Boolean))
        ).sort();
        return [{ id: "all", name: "Todo" }, ...dynamicCats.map(c => ({ id: c, name: c }))];
    })();

    const [internalCategory, setInternalCategory] = useState<string>("all");
    const activeCat = props.selectedCategory ?? internalCategory;

    const filtered = products.filter((product: any) => {
        if (!activeCat || activeCat === "all" || activeCat.toLowerCase() === "todo") {
            const q = (props.searchQuery || "").toString().toLowerCase();
            return !q || (product.name || "").toLowerCase().includes(q);
        }
        const target = activeCat.toString().toLowerCase();
        const prodCat = (product.category || "").toString().toLowerCase();
        return prodCat === target;
    });

    return (
        <div className="relative w-full h-full flex flex-col p-2 bg-slate-50/50 dark:bg-slate-900/50 rounded-xl overflow-hidden">
            <div className="shrink-0 flex items-center gap-1 mb-2">
                <button type="button" onClick={() => scrollCats("left")}
                    className="h-8 w-8 shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold active:scale-95 transition shadow-sm">
                    ◀
                </button>
                <div ref={categoriesRef}
                    className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth items-center">
                    {categoryList.map(cat => (
                        <button key={cat.id} type="button"
                            onClick={() => setInternalCategory(cat.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition active:scale-95 shadow-sm whitespace-nowrap ${activeCat === cat.id ? "bg-blue-600 text-white" : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-100"}`}>
                            {cat.name}
                        </button>
                    ))}
                </div>
                <button type="button" onClick={() => scrollCats("right")}
                    className="h-8 w-8 shrink-0 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold active:scale-95 transition shadow-sm">
                    ▶
                </button>
                <input type="text" value={props.searchQuery || ""}
                    onChange={e => props.onSearchChange?.(e.target.value)}
                    placeholder="Buscar..."
                    className="w-28 sm:w-36 h-8 text-xs px-2.5 rounded-lg border border-slate-200 dark:bg-slate-800 bg-white dark:bg-slate-800 ml-1" />
            </div>
            <div ref={gridContainerRef}
                className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-2 content-start flex-1 overflow-y-auto min-h-0 scroll-smooth pr-12 pb-2">
                {filtered.map((product: any) => (
                    <article key={product.id}
                        onClick={() => props.onAddProduct?.(product)}
                        className="w-full rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1.5 flex flex-col justify-between shadow-sm hover:border-blue-400 transition cursor-pointer select-none active:scale-95">
                        <div className="relative w-full shrink-0 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700" style={{ aspectRatio: "1 / 1" }}>
                            <img src={product.image_url || product.image || FALLBACK_IMG}
                                alt={product.name}
                                className="w-full h-full object-cover transition-opacity"
                                loading="lazy"
                                onError={(e: any) => {
                                    e.target.onerror = null;
                                    e.target.src = FALLBACK_IMG;
                                    e.target.classList.add("opacity-50");
                                }} />
                            <span className="absolute bottom-1 left-1 bg-slate-900/90 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow">
                                {Number(product.price).toFixed(2)} €
                            </span>
                        </div>
                        <div className="mt-1 flex flex-col justify-between flex-1">
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-1 leading-tight">{product.name}</h4>
                            <span className="text-[10px] text-slate-400 truncate">{product.description || product.category}</span>
                        </div>
                    </article>
                ))}
                {filtered.length === 0 && (
                    <div className="col-span-full py-12 text-center text-slate-400 text-xs font-semibold">
                        {products.length === 0 ? (
                            <div>
                                <div className="flex flex-col items-center gap-3 py-8">
                                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center text-3xl">🍽️</div>
                                    <p className="text-[14px] font-bold text-slate-700">
                                        {error ? `Error: ${error}` : "Tu carta está vacía"}
                                    </p>
                                    <p className="text-[11px] text-slate-500 max-w-[220px] leading-relaxed">
                                        {sessionJwt
                                            ? "La query con tu sesión JWT devolvió 0 productos. RLS puede estar bloqueando."
                                            : "No hay sesión activa. Inicia sesión para ver productos."}
                                    </p>
                                    <button type="button"
                                        onClick={() => (window.location.href = "/settings")}
                                        className="mt-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 text-white text-[11px] font-bold hover:from-violet-700 hover:to-blue-700 transition shadow-sm">
                                        Ir a Configuración
                                    </button>
                                </div>
                            </div>
                        ) : "No hay platos en esta categoría."}
                    </div>
                )}
            </div>
        </div>
    );

    function scrollCats(dir: "left" | "right") {
        if (categoriesRef.current) {
            categoriesRef.current.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
        }
    }
}
