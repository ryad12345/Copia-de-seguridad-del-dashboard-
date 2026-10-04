-- =====================================================================
-- MOZONA TPV — database/34_secure_secondary_tables.sql (v3.4.10)
-- =====================================================================
-- Cierra los cabos sueltos detectados en la auditoría de seguridad:
--   1) admin_notifications: SIN RLS habilitado
--   2) invitation_codes: USING (TRUE) WITH CHECK (TRUE) -> abierto
--   3) free_invitations: verificar políticas
--   4) leads_onboarding: verificar políticas
-- =====================================================================

-- =====================================================================
-- ADMIN_NOTIFICATIONS (era el agujero crítico restante)
-- Solo el superadmin (rofixinsta@gmail.com) puede verlas.
-- =====================================================================
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notifications_select_admin" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_modify_admin" ON public.admin_notifications;
DROP POLICY IF EXISTS "admin_notifications_all"           ON public.admin_notifications;

CREATE POLICY "admin_notifications_select_admin" ON public.admin_notifications
    FOR SELECT TO authenticated
    USING (public.is_superadmin());

CREATE POLICY "admin_notifications_modify_admin" ON public.admin_notifications
    FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- =====================================================================
-- INVITATION_CODES (códigos de invitación)
-- =====================================================================
DROP POLICY IF EXISTS "invitation_codes_all"                  ON public.invitation_codes;
DROP POLICY IF EXISTS "Anyone can read active codes"          ON public.invitation_codes;
DROP POLICY IF EXISTS "SuperAdmin manages codes"              ON public.invitation_codes;
DROP POLICY IF EXISTS "invitation_codes_select_own"           ON public.invitation_codes;
DROP POLICY IF EXISTS "invitation_codes_modify_admin"         ON public.invitation_codes;

-- ★ Cualquier usuario autenticado puede leer códigos activos (necesario
--   para que un nuevo camarero pueda canjear una invitación).
CREATE POLICY "invitation_codes_select_active" ON public.invitation_codes
    FOR SELECT TO authenticated
    USING (
        is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_uses IS NULL OR current_uses < max_uses)
    );

-- ★ Solo superadmin puede crear/modificar/borrar códigos
CREATE POLICY "invitation_codes_modify_admin" ON public.invitation_codes
    FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- =====================================================================
-- FREE_INVITATIONS (códigos gratis legacy)
-- =====================================================================
ALTER TABLE public.free_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "free_invitations_select"     ON public.free_invitations;
DROP POLICY IF EXISTS "free_invitations_modify"     ON public.free_invitations;
DROP POLICY IF EXISTS "free_invitations_all"        ON public.free_invitations;

CREATE POLICY "free_invitations_select" ON public.free_invitations
    FOR SELECT TO authenticated
    USING (is_active = TRUE AND expires_at > NOW());

CREATE POLICY "free_invitations_modify" ON public.free_invitations
    FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- =====================================================================
-- LEADS_ONBOARDING (leads del formulario de registro público)
-- =====================================================================
DROP POLICY IF EXISTS "leads_onboarding_all"         ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_select"      ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_modify"      ON public.leads_onboarding;
DROP POLICY IF EXISTS "leads_onboarding_insert"      ON public.leads_onboarding;

-- ★ Cualquiera puede insertar un lead (formulario público)
CREATE POLICY "leads_onboarding_insert" ON public.leads_onboarding
    FOR INSERT TO anon, authenticated
    WITH CHECK (TRUE);

-- ★ Solo superadmin puede ver leads
CREATE POLICY "leads_onboarding_select" ON public.leads_onboarding
    FOR SELECT TO authenticated
    USING (public.is_superadmin());

-- ★ Solo superadmin puede modificar/borrar leads
CREATE POLICY "leads_onboarding_modify" ON public.leads_onboarding
    FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

-- =====================================================================
-- Verificación final: listar todas las tablas con RLS
-- =====================================================================
COMMENT ON TABLE public.admin_notifications IS
    'Notificaciones del admin. Solo rofixinsta@gmail.com puede verlas.';
COMMENT ON TABLE public.invitation_codes IS
    'Códigos de invitación. Lectura: cualquier autenticado (si activo). Escritura: solo superadmin.';
COMMENT ON TABLE public.free_invitations IS
    'Códigos de invitación gratis legacy. Solo superadmin los gestiona.';
COMMENT ON TABLE public.leads_onboarding IS
    'Leads del formulario público de onboarding. Cualquiera puede insertar, solo superadmin ve.';
