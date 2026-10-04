// =====================================================================
// CategoriesPanel v4.4.2 — RPC ZERO-BLOCK
// =====================================================================
// Usa fn_get_tenant_categories / fn_save_category / fn_delete_category
// (SECURITY DEFINER). No más supabase.from('categories') directo.
// =====================================================================

import React, { useState, useEffect } from "react";
import { rpcGetCategories, rpcSaveCategory, rpcDeleteCategory, type CategoryRpc } from "../../lib/rpc";
import { useAuth } from "../../context/AuthContext";
import { FALLBACK_CATEGORIES, type Category } from "../../lib/sync/sync-helpers";

const LS_KEY_CATEGORIES = "pos_custom_categories_chalohiahmd1980@gmail.com";

function loadFromLS(): Category[] {
    try {
        const raw = localStorage.getItem(LS_KEY_CATEGORIES);
        if (raw) {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch {}
    return [];
}

function saveToLS(categories: Category[]) {
    try { localStorage.setItem(LS_KEY_CATEGORIES, JSON.stringify(categories)); } catch {}
}

function toCategoryShape(c: CategoryRpc | any): Category {
    return {
        id: c.id,
        name: c.name,
        sort_order: c.sort_order ?? 0,
        tenant_id: c.tenant_id,
        image_url: c.image_url,
        is_active: c.is_active !== false,
    };
}

export function CategoriesPanel() {
    const auth = useAuth();
    const tenantId = auth?.tenant?.id || "";

    const [categories, setCategories] = useState<Category[]>(() => loadFromLS());
    const [newCat, setNewCat] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<string>("init");

    /**
     * ★ v4.4.2: usar RPC SECURITY DEFINER
     * Reemplaza .from('categories').select() directo
     */
    const loadCategories = async (currentTenantId: string) => {
        if (!currentTenantId) return;
        setLoading(true);
        setError(null);
        try {
            const r = await rpcGetCategories(currentTenantId, false);

            if (!r.ok) {
                console.warn("[CategoriesPanel] RPC fail:", r.error);
                // Fallback a fallback duro
                const fb = FALLBACK_CATEGORIES;
                setCategories(fb);
                saveToLS(fb);
                setSource("fallback");
                return;
            }

            const rows = (r.data?.data || []) as CategoryRpc[];
            if (rows.length === 0) {
                // Sin categorías: usar fallback duro
                const fb = FALLBACK_CATEGORIES;
                setCategories(fb);
                saveToLS(fb);
                setSource("fallback");
                return;
            }

            const mapped: Category[] = rows.map(toCategoryShape);
            setCategories(mapped);
            saveToLS(mapped);
            setSource("supabase");
            console.log("[CategoriesPanel] ✅ cargadas", mapped.length, "vía RPC");
        } catch (e: any) {
            console.warn("[CategoriesPanel] exception:", e?.message);
            setError(e?.message || "Error al cargar");
            // Fallback duro
            const fb = FALLBACK_CATEGORIES;
            setCategories(fb);
            saveToLS(fb);
            setSource("fallback");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!tenantId) return;
        let cancelled = false;
        (async () => {
            if (cancelled) return;
            await loadCategories(tenantId);
        })();
        return () => { cancelled = true; };
    }, [tenantId]);

    /**
     * ★ v4.4.2: añadir categoría via RPC
     */
    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCat.trim() || !tenantId) return;
        setLoading(true);
        setError(null);
        try {
            const r = await rpcSaveCategory({
                tenantId,
                name: newCat.trim(),
                sortOrder: Date.now() % 100000,
            });

            if (!r.ok) {
                setError(r.error || "Error al guardar");
                return;
            }

            // Recargar lista desde BD (vía RPC)
            await loadCategories(tenantId);
            setNewCat("");
        } catch (e: any) {
            setError(e?.message || "Error");
        } finally {
            setLoading(false);
        }
    };

    /**
     * ★ v4.4.2: eliminar categoría via RPC
     */
    const handleDelete = async (id: string) => {
        if (!tenantId) return;
        setLoading(true);
        try {
            const r = await rpcDeleteCategory(tenantId, id);
            if (!r.ok) {
                setError(r.error || "Error al eliminar");
                return;
            }
            const updated = categories.filter((c) => c.id !== id);
            setCategories(updated);
            saveToLS(updated);
            console.log("[CategoriesPanel] ✅ deleted", id);
        } catch (e: any) {
            setError(e?.message || "Error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 rounded-xl text-xs">
                    ⚠ {error}
                </div>
            )}

            <form onSubmit={handleAdd} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h3 className="text-base font-bold text-slate-900">Categorías</h3>
                <p className="text-[11px] text-slate-500 -mt-2">
                    Fuente: <span className="font-bold text-blue-700">{source}</span>
                    {" · "}Total: <span className="font-bold">{categories.length}</span>
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newCat}
                        onChange={(e) => setNewCat(e.target.value)}
                        placeholder="Nueva categoría..."
                        className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500"
                    />
                    <button
                        type="submit"
                        disabled={loading || !newCat.trim()}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50"
                    >
                        {loading ? "..." : "Añadir"}
                    </button>
                </div>
            </form>

            <ul className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                {loading && categories.length === 0 ? (
                    <li className="px-4 py-3 text-xs text-slate-500 text-center">Cargando...</li>
                ) : categories.length === 0 ? (
                    <li className="px-4 py-3 text-xs text-slate-500 text-center">No hay categorías</li>
                ) : (
                    categories.map((c) => (
                        <li key={c.id} className="px-4 py-2.5 flex items-center justify-between">
                            <span className="text-sm text-slate-900">{c.name}</span>
                            <button
                                type="button"
                                onClick={() => handleDelete(c.id)}
                                disabled={loading}
                                className="text-rose-600 text-xs font-bold hover:underline disabled:opacity-50"
                            >
                                Eliminar
                            </button>
                        </li>
                    ))
                )}
            </ul>
        </div>
    );
}
