// =====================================================================
// MOZONA TPV — useWaiters: hook reactivo de gestión de camareros
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import {
    syncWaiters, listCachedWaiters, findByPinCached,
    createWaiter, updateWaiter, deleteWaiterById, resetWaiterPassword,
    resolveRealTenantId,
    type CreateWaiterResult,
    type Waiter, type WaiterRole,
} from "../lib/waiters";
import type { CachedWaiter } from "../lib/offlineStorage";

export interface UseWaitersReturn {
    waiters:       Waiter[];
    loading:       boolean;
    error:         string | null;
    refresh:       () => Promise<void>;
    create:        (input: { name: string; role: WaiterRole }) => Promise<CreateWaiterResult | null>;
    update:        (id: string, patch: { name?: string; role?: WaiterRole; is_active?: boolean }) => Promise<Waiter | null>;
    remove:        (id: string) => Promise<boolean>;
    resetPassword: (id: string) => Promise<string | null>;
    validatePin:   (pin: string) => Promise<CachedWaiter | null>;
}

export function useWaiters(): UseWaitersReturn {
    const auth = useAuth();
    const [waiters, setWaiters] = useState<Waiter[]>([]);
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    const tenantId = auth.tenant?.id ?? null;

    const refresh = useCallback(async () => {
        if (!tenantId) {
            setWaiters([]);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // Resolver UUID real (bypass 'vip-bypass')
            const realId = await resolveRealTenantId(tenantId);
            if (!realId) {
                setWaiters([]);
                setLoading(false);
                return;
            }
            const cached = await listCachedWaiters(realId);
            if (cached.length > 0) {
                setWaiters(cached.map(c => ({
                    id: c.id, tenant_id: c.tenant_id, user_id: c.user_id,
                    name: c.name, email: null, pin_code: c.pin_code,
                    role: c.role, is_active: c.is_active,
                    created_at: new Date(c.cached_at ?? Date.now()).toISOString(),
                })));
            }
            const remote = await syncWaiters(realId);
            setWaiters(remote);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [tenantId]);

    useEffect(() => {
        if (auth.isReady && tenantId) {
            void refresh();
        }
    }, [auth.isReady, tenantId, refresh]);

    const create = useCallback(async (input: { name: string; role: WaiterRole }) => {
        if (!tenantId) return null;
        try {
            // Resolver UUID real antes de crear (bypass 'vip-bypass')
            const realId = await resolveRealTenantId(tenantId);
            if (!realId) {
                setError("No se pudo resolver el tenant_id real");
                return null;
            }
            const result = await createWaiter({ ...input, tenant_id: realId });
            setWaiters(prev => [...prev, result.waiter]);
            return result;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        }
    }, [tenantId]);

    const update = useCallback(async (
        id: string,
        patch: { name?: string; role?: WaiterRole; is_active?: boolean },
    ) => {
        try {
            const w = await updateWaiter(id, patch);
            if (w) setWaiters(prev => prev.map(x => x.id === id ? w : x));
            return w;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        }
    }, []);

    const remove = useCallback(async (id: string) => {
        try {
            await deleteWaiterById(id);
            setWaiters(prev => prev.filter(x => x.id !== id));
            return true;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
        }
    }, []);

    const resetPassword = useCallback(async (id: string) => {
        try {
            const newPwd = await resetWaiterPassword(id);
            return newPwd;
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return null;
        }
    }, []);

    const validatePin = useCallback(async (pin: string) => {
        if (!tenantId) return null;
        const realId = await resolveRealTenantId(tenantId);
        if (!realId) return null;
        return findByPinCached(realId, pin);
    }, [tenantId]);

    return {
        waiters, loading, error,
        refresh, create, update, remove, resetPassword, validatePin,
    };
}
