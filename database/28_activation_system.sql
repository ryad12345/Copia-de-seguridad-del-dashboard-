-- =====================================================================
-- MOZONA TPV — database/28_activation_system.sql
-- =====================================================================
-- Sistema de activacion con 24h de cortesia + 7 dias de trial real
-- Adiós a EmailJS: notificaciones via tabla admin_notifications
-- =====================================================================

-- 1) Extender estados de subscription
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        CREATE TYPE subscription_status AS ENUM (
            'pending_activation',  -- 24h de cortesia inicial
            'active_trial',        -- 7 dias de trial oficial
            'active',              -- plan pagado activo
            'expired',             -- plan caducado
            'cancelled',           -- cancelado por usuario
            'vip'                  -- acceso vitalicio (bypass)
        );
    END IF;
END $$;

-- 2) Añadir columnas nuevas a tenants (idempotente)
-- ★ v2.0.3: Añadir TODAS las columnas que el código cliente y los triggers usan
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS activation_status subscription_status DEFAULT 'pending_activation',
    ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by TEXT,
    ADD COLUMN IF NOT EXISTS plan_selected TEXT,
    ADD COLUMN IF NOT EXISTS restaurant_address TEXT,
    ADD COLUMN IF NOT EXISTS restaurant_phone TEXT,
    ADD COLUMN IF NOT EXISTS business_type TEXT,
    ADD COLUMN IF NOT EXISTS contact_email TEXT,
    ADD COLUMN IF NOT EXISTS business_name TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2.1) Índice único parcial sobre contact_email (para evitar duplicados)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_contact_email_unique
    ON tenants(contact_email)
    WHERE contact_email IS NOT NULL;

-- 3) Tabla de notificaciones internas (sustituye EmailJS)
CREATE TABLE IF NOT EXISTS admin_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'new_registration',
    title TEXT NOT NULL,
    message TEXT,
    payload JSONB DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4) Indice para queries rápidas
CREATE INDEX IF NOT EXISTS idx_admin_notifications_unread
    ON admin_notifications(created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notifications_tenant
    ON admin_notifications(tenant_id);

-- 5) Trigger: al insertar tenant, crear notificación automática
CREATE OR REPLACE FUNCTION notify_new_tenant_registration()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO admin_notifications (tenant_id, type, title, message, payload)
    VALUES (
        NEW.id,
        'new_registration',
        'Nueva alta: ' || COALESCE(NEW.business_name, 'Sin nombre'),
        COALESCE(NEW.business_name, 'Restaurante') ||
            ' se ha registrado y solicita activación. Plan: ' ||
            COALESCE(NEW.plan_selected, '—') ||
            '. Email: ' || COALESCE(NEW.contact_email, '—'),
        jsonb_build_object(
            'tenant_id', NEW.id,
            'business_name', NEW.business_name,
            'plan_selected', NEW.plan_selected,
            'contact_email', NEW.contact_email,
            'grace_period_ends_at', NEW.grace_period_ends_at,
            'created_at', NEW.created_at
        )
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_registration ON tenants;
CREATE TRIGGER trg_tenant_registration
    AFTER INSERT ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION notify_new_tenant_registration();

-- 6) Funcion helper: aprobar alta
CREATE OR REPLACE FUNCTION approve_tenant_activation(
    p_tenant_id UUID,
    p_approved_by TEXT DEFAULT 'superadmin'
)
RETURNS JSONB AS $$
DECLARE
    v_tenant tenants%ROWTYPE;
    v_trial_ends TIMESTAMPTZ;
BEGIN
    SELECT * INTO v_tenant FROM tenants WHERE id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Tenant no encontrado');
    END IF;

    -- Trial oficial: 7 dias desde la aprobacion
    v_trial_ends := NOW() + INTERVAL '7 days';

    UPDATE tenants
    SET activation_status = 'active_trial',
        approved_at = NOW(),
        approved_by = p_approved_by,
        trial_ends_at = v_trial_ends,
        updated_at = NOW()
    WHERE id = p_tenant_id;

    -- Notificar al admin que se aprobó
    INSERT INTO admin_notifications (tenant_id, type, title, message, payload)
    VALUES (
        p_tenant_id,
        'activation_approved',
        'Alta aprobada: ' || COALESCE(v_tenant.business_name, ''),
        'Se ha concedido trial de 7 días. Expira: ' || v_trial_ends::TEXT,
        jsonb_build_object('tenant_id', p_tenant_id, 'trial_ends_at', v_trial_ends)
    );

    RETURN jsonb_build_object(
        'ok', true,
        'tenant_id', p_tenant_id,
        'trial_ends_at', v_trial_ends,
        'status', 'active_trial'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) Comentarios
COMMENT ON TABLE admin_notifications IS 'Notificaciones internas del SuperAdmin (sustituye EmailJS)';
COMMENT ON COLUMN tenants.activation_status IS 'Estado de activacion: pending_activation, active_trial, active, expired';
COMMENT ON COLUMN tenants.grace_period_ends_at IS '24h de cortesia desde el registro';
COMMENT ON COLUMN tenants.trial_ends_at IS '7 dias de trial oficial (post-aprobacion)';
