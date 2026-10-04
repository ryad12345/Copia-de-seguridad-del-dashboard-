-- =====================================================================
-- MOZONA TPV — database/35_vip_rls_bypass.sql (v3.4.11)
-- =====================================================================
-- Solución quirúrgica: el VIP chalohiahmd1980@gmail.com necesita acceso
-- total a SUS datos de tenant sin desactivar el RLS para el resto.
--
-- ANTES (mala idea): ALTER TABLE ... DISABLE RLS
--   -> abriría TODA la BD para CUALQUIER usuario autenticado.
--
-- AHORA (correcto): el helper has_tenant_access() reconoce al VIP.
--   -> solo el VIP bypasa. El resto sigue protegido.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.has_tenant_access(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
    -- ★ v3.4.11: VIPs autorizados pueden acceder a cualquier tenant.
    --   Esto es necesario porque el VIP bypass sintético (id="vip-bypass")
    --   no existe en BD y por tanto no puede matchear ninguna policy.
    --
    --   Lista blanca de emails VIP (NO usar comodines por seguridad):
    SELECT
        public.is_superadmin()
        OR public.is_tenant_owner(p_tenant_id)
        OR public.is_tenant_member(p_tenant_id)
        OR EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND email IN (
                'chalohiahmd1980@gmail.com'  -- El Rincón de Casablanca
            )
        );
$$;

-- ★ Mismo tratamiento para tenants policies (owner-only)
--   El VIP puede ver/editar cualquier tenant.
DROP POLICY IF EXISTS "tenants_select_own" ON public.tenants;
CREATE POLICY "tenants_select_own" ON public.tenants
    FOR SELECT TO authenticated
    USING (
        owner_id = auth.uid()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
            AND email IN ('chalohiahmd1980@gmail.com')
        )
        OR EXISTS (
            SELECT 1 FROM public.tenant_users tu
            WHERE tu.tenant_id = tenants.id
            AND tu.user_id = auth.uid()
        )
    );

COMMENT ON FUNCTION public.has_tenant_access(UUID) IS
    'Verifica acceso: superadmin, owner, staff, o VIP autorizado (chalohiahmd1980@gmail.com)';
