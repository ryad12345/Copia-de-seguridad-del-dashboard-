-- =====================================================================
-- MOZONA TPV — 07_vip_unlock.sql
-- =====================================================================
-- Desbloquea permanentemente a los usuarios VIP definidos en
-- src/lib/vip.ts (chalohiahmd1980@gmail.com, rofixinsta@gmail.com).
--
-- Lo que hace:
--   1. Crea/actualiza el tenant con plan=lifetime_vip, status=active,
--      onboarding_completed=true
--   2. Asegura que tenant_users los tiene como 'owner'
--   3. Idempotente: puede ejecutarse múltiples veces sin error
--   4. Sólo afecta a los emails de VIP_EMAILS
-- =====================================================================

DO $$
DECLARE
    v_email TEXT;
    v_user_id UUID;
    v_tenant_id UUID;
    v_tenant_name TEXT;
BEGIN
    -- Para cada email VIP, buscar/crear/actualizar su tenant
    FOREACH v_email IN ARRAY ARRAY[
        'chalohiahmd1980@gmail.com',
        'rofixinsta@gmail.com'
    ]
    LOOP
        -- 1) Buscar user_id en auth.users
        SELECT id INTO v_user_id FROM auth.users WHERE email = v_email LIMIT 1;

        IF v_user_id IS NULL THEN
            RAISE NOTICE '[vip_unlock] Usuario % no existe en auth.users — saltando', v_email;
            CONTINUE;
        END IF;

        -- 2) Definir nombre del tenant según email
        IF v_email = 'chalohiahmd1980@gmail.com' THEN
            v_tenant_name := 'El Rincón de Casablanca';
        ELSE
            v_tenant_name := 'MOZONA HQ';
        END IF;

        -- 3) Buscar tenant existente por owner_id
        SELECT id INTO v_tenant_id FROM public.tenants WHERE owner_id = v_user_id LIMIT 1;

        IF v_tenant_id IS NULL THEN
            -- 3a) Crear tenant
            INSERT INTO public.tenants (
                name, owner_id, plan, subscription_status,
                onboarding_completed, default_tax_rate
            ) VALUES (
                v_tenant_name, v_user_id, 'lifetime_vip', 'active',
                TRUE, 10.00
            )
            RETURNING id INTO v_tenant_id;
            RAISE NOTICE '[vip_unlock] Tenant creado para %: %', v_email, v_tenant_id;
        ELSE
            -- 3b) Actualizar tenant a VIP
            UPDATE public.tenants
            SET plan = 'lifetime_vip',
                subscription_status = 'active',
                onboarding_completed = TRUE,
                name = v_tenant_name
            WHERE id = v_tenant_id;
            RAISE NOTICE '[vip_unlock] Tenant actualizado para %: %', v_email, v_tenant_id;
        END IF;

        -- 4) Vincular como owner en tenant_users
        INSERT INTO public.tenant_users (
            tenant_id, user_id, email, role, pin_code
        ) VALUES (
            v_tenant_id, v_user_id, v_email, 'owner', '1234'
        )
        ON CONFLICT (tenant_id, COALESCE(user_id::text, ''))
        DO UPDATE SET
            email = EXCLUDED.email,
            role = 'owner',
            pin_code = COALESCE(public.tenant_users.pin_code, '1234');

        -- 5) Marcar al user como superadmin en metadata (para bypass frontend)
        UPDATE auth.users
        SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                                 || jsonb_build_object('is_superadmin', TRUE)
        WHERE id = v_user_id;

        RAISE NOTICE '[vip_unlock] ✓ % configurado como VIP owner', v_email;
    END LOOP;
END $$;

-- 6) Verificación
SELECT
    u.email,
    t.name AS tenant,
    t.plan,
    t.subscription_status,
    t.onboarding_completed,
    tu.role
FROM auth.users u
LEFT JOIN public.tenants t ON t.owner_id = u.id
LEFT JOIN public.tenant_users tu ON tu.user_id = u.id
WHERE u.email IN ('chalohiahmd1980@gmail.com', 'rofixinsta@gmail.com')
ORDER BY u.email;

NOTIFY pgrst, 'reload schema';

-- =====================================================================
-- Si necesitas resetear el password de chalohiahmd1980@gmail.com:
--   UPDATE auth.users
--   SET encrypted_password = crypt('<TU_PASSWORD_SEGURA>', gen_salt('bf'))
--   WHERE email = 'chalohiahmd1980@gmail.com';
-- =====================================================================
