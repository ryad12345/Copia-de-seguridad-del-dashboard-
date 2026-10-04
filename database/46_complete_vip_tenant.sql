-- =====================================================================
-- MOZONA TPV — SQL #46 — Completar datos del Tenant VIP
-- =====================================================================
-- Rellena campos vacíos del tenant "El Rincón de Casablanca"
-- Ejecutar UNA vez en Supabase SQL Editor
-- =====================================================================

UPDATE public.tenants
SET
    business_name      = 'El Rincón de Casablanca',
    restaurant_address = 'calle jacento venvente numero 3 local 8',
    restaurant_phone   = '+34614167225',
    postal_code        = '28001',
    city               = 'Madrid',
    contact_email      = 'chalohiahmd1980@gmail.com',
    business_type      = 'restaurant',
    activation_status  = 'active',
    approved_at        = COALESCE(approved_at, now()),
    updated_at         = now()
WHERE id = '58a8e6f5-3172-409c-8aa5-ae02be0b7e76';

-- Verificar
SELECT
    id,
    name,
    business_name,
    cif_nif,
    address,
    restaurant_address,
    phone,
    restaurant_phone,
    city,
    postal_code,
    activation_status,
    plan,
    subscription_status
FROM public.tenants
WHERE id = '58a8e6f5-3172-409c-8aa5-ae02be0b7e76';
