-- =====================================================================
-- MOZONA TPV — 06_invitation_codes.sql
-- =====================================================================
-- Sistema de códigos de invitación que permiten a un nuevo cliente
-- activar un plan (normalmente lifetime_vip) sin pasar por Stripe.
--
-- FLUJO:
--   1. El SuperAdmin genera un código en /admin/invites
--   2. El cliente pega el código en /pricing → "Canjear"
--   3. La RPC `redeem_invitation_token` valida y consume un uso
--   4. El frontend redirige a /register?invite_code=...&plan=lifetime_vip
--   5. /register aplica el plan al crear el tenant (sin Stripe)
--
-- SEGURO: la RPC valida expiración y max_uses.  Si max_uses=NULL,
-- se considera ilimitado.
-- =====================================================================

-- 1) Tabla de códigos (idempotente) ---------------------------------
CREATE TABLE IF NOT EXISTS public.invitation_codes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        UNIQUE NOT NULL,
    plan        TEXT        NOT NULL DEFAULT 'lifetime_vip'
                            CHECK (plan IN ('plus_30', 'pro_50', 'lifetime_vip')),
    created_by  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
    max_uses    INT         DEFAULT NULL,           -- NULL = ilimitado
    times_used  INT         NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ DEFAULT NULL,           -- NULL = sin caducidad
    note        TEXT        DEFAULT NULL,           -- p.ej. "Promo Black Friday"
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para lookup rápido por code (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS invitation_codes_code_lower_idx
    ON public.invitation_codes(LOWER(code));

-- 2) RLS -------------------------------------------------------------
ALTER TABLE public.invitation_codes ENABLE ROW LEVEL SECURITY;

-- Lectura pública: cualquiera puede validar un código (necesario
-- para anon en el formulario /pricing)
DROP POLICY IF EXISTS "Anyone can read active codes" ON public.invitation_codes;
CREATE POLICY "Anyone can read active codes"
    ON public.invitation_codes FOR SELECT
    USING (is_active = TRUE);

-- Inserción/borrado: sólo SuperAdmin
DROP POLICY IF EXISTS "SuperAdmin manages codes" ON public.invitation_codes;
CREATE POLICY "SuperAdmin manages codes"
    ON public.invitation_codes FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
              AND (raw_user_meta_data->>'is_superadmin')::boolean = TRUE
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM auth.users
            WHERE id = auth.uid()
              AND (raw_user_meta_data->>'is_superadmin')::boolean = TRUE
        )
    );

-- 3) RPC: validar y consumir un código ------------------------------
CREATE OR REPLACE FUNCTION public.redeem_invitation_token(
    p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_inv         RECORD;
    v_effective_uses INT;
BEGIN
    -- Normalizar (trim + uppercase)
    SELECT id, code, plan, max_uses, times_used, expires_at, is_active
    INTO v_inv
    FROM public.invitation_codes
    WHERE LOWER(code) = LOWER(TRIM(p_code))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Código de invitación no válido');
    END IF;

    IF v_inv.is_active = FALSE THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Este código está desactivado');
    END IF;

    IF v_inv.expires_at IS NOT NULL AND v_inv.expires_at < NOW() THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El código de invitación ha caducado');
    END IF;

    v_effective_uses := COALESCE(v_inv.max_uses, 0);
    IF v_inv.max_uses IS NOT NULL AND v_inv.times_used >= v_inv.max_uses THEN
        RETURN jsonb_build_object('ok', false, 'error', 'El código ha alcanzado el límite de usos');
    END IF;

    -- Incrementar contador
    UPDATE public.invitation_codes
    SET times_used = times_used + 1
    WHERE id = v_inv.id;

    RETURN jsonb_build_object(
        'ok',        true,
        'plan',      v_inv.plan,
        'code',      v_inv.code,
        'max_uses',  v_inv.max_uses,
        'remaining', CASE
                       WHEN v_inv.max_uses IS NULL THEN NULL
                       ELSE v_inv.max_uses - v_inv.times_used
                     END
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_invitation_token(TEXT) TO anon, authenticated;

-- 4) RPC auxiliar: marcar un usuario como superadmin (bootstrap) ----
--    Si necesitas crear el primer superadmin, ejecuta manualmente:
--      UPDATE auth.users
--      SET raw_user_meta_data = raw_user_meta_data || '{"is_superadmin": true}'::jsonb
--      WHERE email = 'rofixinsta@gmail.com';
--
-- 5) Código de ejemplo (NO ejecutar en producción, sólo desarrollo):
-- INSERT INTO public.invitation_codes (code, plan, max_uses, note)
-- VALUES ('MOZONA-VIP-2026', 'lifetime_vip', NULL, 'Promo lanzamiento');

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- VERIFICACIÓN:
--   SELECT * FROM public.invitation_codes ORDER BY created_at DESC;
--   SELECT * FROM public.redeem_invitation_token('MOZONA-VIP-2026');
-- =====================================================================
