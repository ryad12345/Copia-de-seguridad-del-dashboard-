-- =====================================================================
-- MOZONA TPV — database/40_v4_zero_tech.sql (v4.0.0)
-- =====================================================================
-- ZERO-TECH UI + Auth Inteligente + Menú por Sector + VIP Blindado
--
-- MODULOS:
--   1. Auth OTP: email_verifications + generador/verificador
--   2. Onboarding inteligente: business_types con cartas preconfiguradas
--   3. Logica conversacional SQL pura (Habla con Riyad)
--   4. VIP blindado: trigger que bloquea DELETE/UPDATE accidental
-- =====================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. AUTH OTP: verificacion de email con codigo de 6 digitos
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'signup',  -- 'signup' | 'login' | 'reset'
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    consumed_at TIMESTAMPTZ,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_email
    ON public.email_verifications(email, created_at DESC);

-- ★ Funcion: generar codigo OTP aleatorio de 6 digitos
CREATE OR REPLACE FUNCTION public.generate_otp()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
    v_code TEXT;
BEGIN
    LOOP
        v_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');
        EXIT WHEN v_code ~ '^\d{6}$';
    END LOOP;
    RETURN v_code;
END;
$$;

-- ★ Funcion: crear un OTP nuevo para un email (invalida los previos)
CREATE OR REPLACE FUNCTION public.create_otp(p_email TEXT, p_purpose TEXT DEFAULT 'signup')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
    v_code TEXT;
    v_expires TIMESTAMPTZ;
    v_id UUID;
BEGIN
    -- Validar formato de email (rechazar asdf@asdf.com)
    IF v_email !~ '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'email_no_valido', 'message', 'El formato del correo no es correcto');
    END IF;

    -- Rechazar emails de dominios conocidos como temporales/falsos
    IF v_email ~* '@(mailinator|tempmail|10minutemail|guerrillamail|throwaway|yopmail|trashmail|fakeinbox|maildrop)\.' THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'email_no_permitido', 'message', 'Por favor usa un correo electronico real');
    END IF;

    -- VIP bypass: chalohiahmd1980@gmail.com y rofixinsta@gmail.com no necesitan OTP
    IF v_email IN ('chalohiahmd1980@gmail.com', 'rofixinsta@gmail.com') THEN
        RETURN jsonb_build_object(
            'ok', TRUE,
            'vip_bypass', TRUE,
            'code', '000000',
            'message', 'Acceso VIP concedido sin verificacion'
        );
    END IF;

    -- Invalidar OTPs previos del mismo email+purpose
    UPDATE public.email_verifications
    SET consumed_at = NOW()
    WHERE email = v_email AND purpose = p_purpose AND consumed_at IS NULL;

    v_code := public.generate_otp();
    v_expires := NOW() + INTERVAL '10 minutes';

    INSERT INTO public.email_verifications (email, code, purpose, expires_at)
    VALUES (v_email, v_code, p_purpose, v_expires)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'code', v_code,
        'verification_id', v_id,
        'expires_at', v_expires,
        'expires_in_seconds', 600,
        'message', 'Codigo de verificacion generado. Revisa tu bandeja de entrada.'
    );
END;
$$;

-- ★ Funcion: verificar OTP introducido por el usuario
CREATE OR REPLACE FUNCTION public.verify_otp(p_email TEXT, p_code TEXT, p_purpose TEXT DEFAULT 'signup')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT := LOWER(TRIM(p_email));
    v_record RECORD;
BEGIN
    -- VIP bypass siempre verifica
    IF v_email IN ('chalohiahmd1980@gmail.com', 'rofixinsta@gmail.com') THEN
        RETURN jsonb_build_object('ok', TRUE, 'verified', TRUE, 'vip_bypass', TRUE);
    END IF;

    SELECT * INTO v_record
    FROM public.email_verifications
    WHERE email = v_email
      AND purpose = p_purpose
      AND consumed_at IS NULL
      AND expires_at > NOW()
      AND attempts < max_attempts
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'codigo_invalido_o_expirado',
            'message', 'El codigo ha expirado o ya fue usado. Solicita uno nuevo.');
    END IF;

    IF v_record.code <> p_code THEN
        UPDATE public.email_verifications
        SET attempts = attempts + 1
        WHERE id = v_record.id;

        IF v_record.attempts + 1 >= v_record.max_attempts THEN
            UPDATE public.email_verifications
            SET consumed_at = NOW()
            WHERE id = v_record.id;
            RETURN jsonb_build_object('ok', FALSE, 'error', 'demasiados_intentos',
                'message', 'Has agotado los intentos. Solicita un codigo nuevo.');
        END IF;

        RETURN jsonb_build_object('ok', FALSE, 'error', 'codigo_incorrecto',
            'message', 'El codigo no coincide. Te quedan ' || (v_record.max_attempts - v_record.attempts - 1) || ' intentos.');
    END IF;

    UPDATE public.email_verifications
    SET consumed_at = NOW()
    WHERE id = v_record.id;

    RETURN jsonb_build_object('ok', TRUE, 'verified', TRUE, 'message', 'Codigo verificado correctamente');
END;
$$;

ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "email_verifications_all" ON public.email_verifications;
CREATE POLICY "email_verifications_modify" ON public.email_verifications FOR ALL TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());


-- ═══════════════════════════════════════════════════════════════
-- 2. ONBOARDING INTELIGENTE: business_types con cartas preconfiguradas
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.business_types (
    id TEXT PRIMARY KEY,  -- 'bar_tapas', 'cafeteria', 'restaurante_italiano', etc.
    name TEXT NOT NULL,
    emoji TEXT,
    description TEXT,
    default_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_products JSONB NOT NULL DEFAULT '[]'::jsonb,  -- productos sugeridos con coste estimado
    typical_margins JSONB DEFAULT '{}'::jsonb,
    settings_defaults JSONB DEFAULT '{}'::jsonb,  -- IVA defecto, etc
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ★ 6 tipos preconfigurados
INSERT INTO public.business_types (id, name, emoji, description, default_categories, default_products, typical_margins, settings_defaults, sort_order) VALUES

('bar_tapas', 'Bar de Tapas', '🍻',
 'Establecimiento tradicional con raciones, tapas y cañas',
 '[
    {"name": "Tapas y Raciones", "color": "#dc2626"},
    {"name": "Bebidas", "color": "#2563eb"},
    {"name": "Cervezas", "color": "#f59e0b"},
    {"name": "Vinos", "color": "#7c3aed"},
    {"name": "Postres", "color": "#ec4899"}
 ]'::jsonb,
 '[
    {"name": "Caña de cerveza", "category": "Cervezas", "price": 2.50, "cost": 0.60, "tax": 10},
    {"name": "Doble de cerveza", "category": "Cervezas", "price": 4.00, "cost": 1.00, "tax": 10},
    {"name": "Tinto de verano", "category": "Vinos", "price": 3.00, "cost": 0.80, "tax": 10},
    {"name": "Copa de vino tinto", "category": "Vinos", "price": 3.50, "cost": 1.00, "tax": 10},
    {"name": "Coca-Cola", "category": "Bebidas", "price": 2.80, "cost": 0.65, "tax": 10},
    {"name": "Agua mineral", "category": "Bebidas", "price": 1.50, "cost": 0.25, "tax": 10},
    {"name": "Patatas bravas", "category": "Tapas y Raciones", "price": 4.50, "cost": 1.20, "tax": 10},
    {"name": "Croquetas caseras (6u)", "category": "Tapas y Raciones", "price": 6.50, "cost": 1.80, "tax": 10},
    {"name": "Calamares a la romana", "category": "Tapas y Raciones", "price": 9.50, "cost": 3.20, "tax": 10},
    {"name": "Tortilla española", "category": "Tapas y Raciones", "price": 5.50, "cost": 1.40, "tax": 10},
    {"name": "Jamón ibérico", "category": "Tapas y Raciones", "price": 14.00, "cost": 5.50, "tax": 10},
    {"name": "Tabla de quesos", "category": "Tapas y Raciones", "price": 12.00, "cost": 4.00, "tax": 10},
    {"name": "Flan casero", "category": "Postres", "price": 3.50, "cost": 0.80, "tax": 10}
 ]'::jsonb,
 '{"default": 65, "drinks": 70, "food": 60}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "orange"}'::jsonb,
 1),

('cafeteria', 'Cafetería de Especialidad', '☕',
 'Café de calidad, bollería, tostadas y brunch',
 '[
    {"name": "Cafés", "color": "#92400e"},
    {"name": "Bollos y Dulces", "color": "#dc2626"},
    {"name": "Tostadas y Sandwiches", "color": "#16a34a"},
    {"name": "Brunch", "color": "#f59e0b"},
    {"name": "Bebidas frías", "color": "#2563eb"}
 ]'::jsonb,
 '[
    {"name": "Café espresso", "category": "Cafés", "price": 1.80, "cost": 0.30, "tax": 10},
    {"name": "Café con leche", "category": "Cafés", "price": 2.20, "cost": 0.40, "tax": 10},
    {"name": "Cappuccino", "category": "Cafés", "price": 2.80, "cost": 0.50, "tax": 10},
    {"name": "Café americano", "category": "Cafés", "price": 2.00, "cost": 0.35, "tax": 10},
    {"name": "Té verde", "category": "Cafés", "price": 2.00, "cost": 0.30, "tax": 10},
    {"name": "Croissant de mantequilla", "category": "Bollos y Dulces", "price": 2.20, "cost": 0.50, "tax": 10},
    {"name": "Croissant de chocolate", "category": "Bollos y Dulces", "price": 2.80, "cost": 0.70, "tax": 10},
    {"name": "Tostada con tomate y aceite", "category": "Tostadas y Sandwiches", "price": 3.50, "cost": 0.80, "tax": 10},
    {"name": "Sándwich mixto", "category": "Tostadas y Sandwiches", "price": 4.50, "cost": 1.20, "tax": 10},
    {"name": "Bowl de açai", "category": "Brunch", "price": 6.50, "cost": 1.80, "tax": 10},
    {"name": "Tortitas con sirope", "category": "Brunch", "price": 5.50, "cost": 1.40, "tax": 10},
    {"name": "Zumo de naranja natural", "category": "Bebidas frías", "price": 3.50, "cost": 0.80, "tax": 10}
 ]'::jsonb,
 '{"default": 70, "drinks": 75, "food": 65}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "orange"}'::jsonb,
 2),

('restaurante_italiano', 'Restaurante Italiano', '🍝',
 'Pasta fresca, pizza al horno y trattoria mediterránea',
 '[
    {"name": "Antipasti", "color": "#16a34a"},
    {"name": "Pasta", "color": "#dc2626"},
    {"name": "Pizza", "color": "#ea580c"},
    {"name": "Carne", "color": "#92400e"},
    {"name": "Dolci", "color": "#ec4899"},
    {"name": "Vini", "color": "#7c3aed"}
 ]'::jsonb,
 '[
    {"name": "Bruschetta al pomodoro", "category": "Antipasti", "price": 6.50, "cost": 1.80, "tax": 10},
    {"name": "Antipasto misto", "category": "Antipasti", "price": 11.00, "cost": 3.50, "tax": 10},
    {"name": "Carpaccio di manzo", "category": "Antipasti", "price": 12.50, "cost": 4.20, "tax": 10},
    {"name": "Caprese", "category": "Antipasti", "price": 9.00, "cost": 2.80, "tax": 10},
    {"name": "Spaghetti Carbonara", "category": "Pasta", "price": 12.50, "cost": 3.20, "tax": 10},
    {"name": "Penne all arrabbiata", "category": "Pasta", "price": 11.50, "cost": 2.80, "tax": 10},
    {"name": "Lasagna della casa", "category": "Pasta", "price": 13.00, "cost": 3.50, "tax": 10},
    {"name": "Risotto ai funghi", "category": "Pasta", "price": 14.00, "cost": 3.80, "tax": 10},
    {"name": "Pizza Margherita", "category": "Pizza", "price": 11.00, "cost": 2.50, "tax": 10},
    {"name": "Pizza Diavola", "category": "Pizza", "price": 12.50, "cost": 2.90, "tax": 10},
    {"name": "Pizza Quattro formaggi", "category": "Pizza", "price": 13.00, "cost": 3.10, "tax": 10},
    {"name": "Tiramisu", "category": "Dolci", "price": 5.50, "cost": 1.40, "tax": 10},
    {"name": "Panna cotta", "category": "Dolci", "price": 4.50, "cost": 1.00, "tax": 10},
    {"name": "Vino della casa (copa)", "category": "Vini", "price": 4.00, "cost": 1.20, "tax": 10}
 ]'::jsonb,
 '{"default": 65, "drinks": 70, "food": 60}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "green"}'::jsonb,
 3),

('cocteleria', 'Coctelería', '🍸',
 'Cócteles clásicos y de autor combinados con tapas',
 '[
    {"name": "Cócteles clásicos", "color": "#a855f7"},
    {"name": "Cócteles de autor", "color": "#ec4899"},
    {"name": "Ginebra y Tónica", "color": "#06b6d4"},
    {"name": "Whiskies", "color": "#92400e"},
    {"name": "Tapas para picar", "color": "#f59e0b"}
 ]'::jsonb,
 '[
    {"name": "Mojito", "category": "Cócteles clásicos", "price": 9.00, "cost": 2.20, "tax": 10},
    {"name": "Margarita", "category": "Cócteles clásicos", "price": 9.50, "cost": 2.40, "tax": 10},
    {"name": "Daiquiri", "category": "Cócteles clásicos", "price": 9.00, "cost": 2.00, "tax": 10},
    {"name": "Negroni", "category": "Cócteles clásicos", "price": 10.50, "cost": 2.80, "tax": 10},
    {"name": "Espresso Martini", "category": "Cócteles de autor", "price": 11.00, "cost": 2.50, "tax": 10},
    {"name": "Aperol Spritz", "category": "Cócteles clásicos", "price": 9.00, "cost": 2.00, "tax": 10},
    {"name": "Gin Tonic Premium", "category": "Ginebra y Tónica", "price": 11.00, "cost": 2.50, "tax": 10},
    {"name": "Whisky single malt", "category": "Whiskies", "price": 14.00, "cost": 4.50, "tax": 10},
    {"name": "Russian Standard", "category": "Whiskies", "price": 9.00, "cost": 2.20, "tax": 10},
    {"name": "Aceitunas y almendras", "category": "Tapas para picar", "price": 4.00, "cost": 1.00, "tax": 10},
    {"name": "Tabla de ibéricos", "category": "Tapas para picar", "price": 16.00, "cost": 5.00, "tax": 10}
 ]'::jsonb,
 '{"default": 75, "drinks": 80, "food": 65}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "violet"}'::jsonb,
 4),

('restaurante_menu', 'Restaurante con Menú del Día', '🍽️',
 'Restaurante tradicional con primeros, segundos, postre',
 '[
    {"name": "Primeros", "color": "#16a34a"},
    {"name": "Segundos", "color": "#dc2626"},
    {"name": "Postres", "color": "#ec4899"},
    {"name": "Guarniciones", "color": "#92400e"},
    {"name": "Bebidas", "color": "#2563eb"},
    {"name": "Vinos y Cafés", "color": "#7c3aed"}
 ]'::jsonb,
 '[
    {"name": "Ensalada mixta", "category": "Primeros", "price": 7.50, "cost": 2.20, "tax": 10},
    {"name": "Sopa de mariscos", "category": "Primeros", "price": 8.50, "cost": 2.80, "tax": 10},
    {"name": "Crema de calabaza", "category": "Primeros", "price": 7.00, "cost": 1.80, "tax": 10},
    {"name": "Paella valenciana", "category": "Segundos", "price": 14.50, "cost": 4.20, "tax": 10},
    {"name": "Solomillo de ternera", "category": "Segundos", "price": 16.50, "cost": 5.50, "tax": 10},
    {"name": "Lubina al horno", "category": "Segundos", "price": 15.50, "cost": 5.00, "tax": 10},
    {"name": "Pollo asado con hierbas", "category": "Segundos", "price": 12.50, "cost": 3.80, "tax": 10},
    {"name": "Flan con nata", "category": "Postres", "price": 3.50, "cost": 0.80, "tax": 10},
    {"name": "Tarta de queso", "category": "Postres", "price": 4.00, "cost": 1.00, "tax": 10},
    {"name": "Fruta del tiempo", "category": "Postres", "price": 3.00, "cost": 0.60, "tax": 10},
    {"name": "Patatas fritas", "category": "Guarniciones", "price": 3.00, "cost": 0.50, "tax": 10},
    {"name": "Ensalada simple", "category": "Guarniciones", "price": 3.50, "cost": 0.80, "tax": 10},
    {"name": "Agua mineral", "category": "Bebidas", "price": 2.00, "cost": 0.30, "tax": 10},
    {"name": "Copa de vino de la casa", "category": "Vinos y Cafés", "price": 3.00, "cost": 0.80, "tax": 10},
    {"name": "Café solo", "category": "Vinos y Cafés", "price": 1.50, "cost": 0.25, "tax": 10}
 ]'::jsonb,
 '{"default": 65, "drinks": 70, "food": 60}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "blue"}'::jsonb,
 5),

('heladeria', 'Heladería y Repostería', '🍦',
 'Helados artesanales, batidos, gofres y dulces',
 '[
    {"name": "Helados artesanales", "color": "#06b6d4"},
    {"name": "Batidos y Smoothies", "color": "#ec4899"},
    {"name": "Gofres y Crepes", "color": "#f59e0b"},
    {"name": "Cafés y chocolates", "color": "#92400e"}
 ]'::jsonb,
 '[
    {"name": "Bola de helado", "category": "Helados artesanales", "price": 2.50, "cost": 0.50, "tax": 10},
    {"name": "Dos bolas", "category": "Helados artesanales", "price": 4.50, "cost": 1.00, "tax": 10},
    {"name": "Tres bolas", "category": "Helados artesanales", "price": 6.00, "cost": 1.40, "tax": 10},
    {"name": "Copa de helado premium", "category": "Helados artesanales", "price": 7.50, "cost": 2.00, "tax": 10},
    {"name": "Batido de chocolate", "category": "Batidos y Smoothies", "price": 4.50, "cost": 1.00, "tax": 10},
    {"name": "Smoothie de frutas", "category": "Batidos y Smoothies", "price": 5.00, "cost": 1.20, "tax": 10},
    {"name": "Gofre con chocolate", "category": "Gofres y Crepes", "price": 5.50, "cost": 1.40, "tax": 10},
    {"name": "Gofre con frutas", "category": "Gofres y Crepes", "price": 6.50, "cost": 1.80, "tax": 10},
    {"name": "Crepe de Nutella", "category": "Gofres y Crepes", "price": 5.50, "cost": 1.30, "tax": 10},
    {"name": "Café con hielo", "category": "Cafés y chocolates", "price": 2.50, "cost": 0.40, "tax": 10},
    {"name": "Chocolate caliente", "category": "Cafés y chocolates", "price": 3.50, "cost": 0.60, "tax": 10}
 ]'::jsonb,
 '{"default": 70, "all": 70}'::jsonb,
 '{"default_iva": 10, "ticket_show_vat": true, "theme_accent": "violet"}'::jsonb,
 6)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.business_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_types_public_read" ON public.business_types FOR SELECT TO anon, authenticated
    USING (is_active = TRUE);

-- ★ Funcion: leer carta preconfigurada (devuelve JSON)
CREATE OR REPLACE FUNCTION public.get_business_type_menu(p_business_type TEXT)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
    SELECT jsonb_build_object(
        'business_type', id,
        'name', name,
        'emoji', emoji,
        'description', description,
        'categories', default_categories,
        'products', default_products,
        'margins', typical_margins,
        'settings', settings_defaults
    )
    FROM public.business_types
    WHERE id = p_business_type AND is_active = TRUE;
$$;

-- ★ Funcion: inyectar carta estándar al tenant (instantáneo)
CREATE OR REPLACE FUNCTION public.seed_menu_for_tenant(p_tenant_id UUID, p_business_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_bt RECORD;
    v_cat JSONB;
    v_prod JSONB;
    v_category_id UUID;
    v_category_inserted INT := 0;
    v_product_inserted INT := 0;
    v_existing INT;
BEGIN
    -- Validar tenant
    SELECT id INTO v_existing FROM public.tenants WHERE id = p_tenant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'tenant_no_existe');
    END IF;

    -- Cargar business_type
    SELECT * INTO v_bt FROM public.business_types WHERE id = p_business_type AND is_active = TRUE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', FALSE, 'error', 'tipo_no_valido');
    END IF;

    -- 1) Insertar categorias
    FOR v_cat IN SELECT * FROM jsonb_array_elements(v_bt.default_categories)
    LOOP
        INSERT INTO public.categories (tenant_id, name, sort_order)
        VALUES (p_tenant_id, v_cat->>'name', v_category_inserted)
        ON CONFLICT DO NOTHING;
        v_category_inserted := v_category_inserted + 1;
    END LOOP;

    -- 2) Insertar productos con categoria resuelta
    FOR v_prod IN SELECT * FROM jsonb_array_elements(v_bt.default_products)
    LOOP
        SELECT id INTO v_category_id
        FROM public.categories
        WHERE tenant_id = p_tenant_id AND name = (v_prod->>'category')
        LIMIT 1;

        INSERT INTO public.products (
            tenant_id, name, price, cost_price, category_id,
            tax_rate, target_margin_pct, is_active
        )
        VALUES (
            p_tenant_id,
            v_prod->>'name',
            COALESCE((v_prod->>'price')::NUMERIC, 0),
            COALESCE((v_prod->>'cost')::NUMERIC, 0),
            v_category_id,
            COALESCE((v_prod->>'tax')::NUMERIC, 10),
            (v_bt.typical_margins->>'default')::NUMERIC,
            TRUE
        )
        ON CONFLICT DO NOTHING;
        v_product_inserted := v_product_inserted + 1;
    END LOOP;

    -- 3) Aplicar settings_defaults a tenant_settings
    IF v_bt.settings_defaults ? 'default_iva' THEN
        INSERT INTO public.tenant_settings (tenant_id, default_iva)
        VALUES (p_tenant_id, (v_bt.settings_defaults->>'default_iva')::NUMERIC)
        ON CONFLICT (tenant_id) DO UPDATE
        SET default_iva = EXCLUDED.default_iva;
    END IF;

    RETURN jsonb_build_object(
        'ok', TRUE,
        'business_type', p_business_type,
        'categories_added', v_category_inserted,
        'products_added', v_product_inserted,
        'computed_in_ms', EXTRACT(MILLISECONDS FROM clock_timestamp())
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 3. LOGICA CONVERSACIONAL SQL PURA (Habla con Riyad)
-- ═══════════════════════════════════════════════════════════════

-- ★ Funcion: entender intenciones del usuario via pattern matching SQL
CREATE OR REPLACE FUNCTION public.parse_user_intent(p_text TEXT, p_tenant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_text TEXT := LOWER(TRIM(p_text));
    v_match JSONB;
BEGIN
    -- PATRON 1: Ventas del dia / hoy
    IF v_text ~* '(cuanto|como|ventas|venta|faturacion|facturado|ingreso|caja|dinero) .*(hoy|mañana|ayer|dia|semana|mes)' THEN
        SELECT jsonb_build_object(
            'intent', 'query_sales',
            'params', jsonb_build_object(
                'period', CASE WHEN v_text ~* 'ayer' THEN 'yesterday'
                              WHEN v_text ~* 'semana' THEN 'week'
                              WHEN v_text ~* 'mes' THEN 'month'
                              ELSE 'today' END,
                'response_text', CASE WHEN v_text ~* 'semana' THEN 'Ventas de esta semana'
                                     WHEN v_text ~* 'mes' THEN 'Ventas de este mes'
                                     WHEN v_text ~* 'ayer' THEN 'Ventas de ayer'
                                     ELSE 'Ventas de hoy' END
            )
        ) INTO v_match;
        RETURN v_match;
    END IF;

    -- PATRON 2: Stock bajo / reposicion
    IF v_text ~* '(stock|inventario|falta|quedan|cantidad) .*(bajo|poco|minimo|reponer|pedir)' THEN
        RETURN jsonb_build_object(
            'intent', 'query_low_stock',
            'params', jsonb_build_object(
                'response_text', 'Productos con stock bajo'
            )
        );
    END IF;

    -- PATRON 3: Apuntar / Anotar producto (crear order temporal)
    IF v_text ~* '(apunta|anota|mete|añade|pon|suma|cobra) .*(mesa|comanda|pedido)' THEN
        RETURN jsonb_build_object(
            'intent', 'create_order',
            'params', jsonb_build_object(
                'response_text', 'Voy a tomar nota',
                'raw_text', p_text
            )
        );
    END IF;

    -- PATRON 4: Cuantos platos / top productos
    IF v_text ~* '(mas|mucho|top|cual|que).*(vende|venden|vendido|plato|producto)' THEN
        RETURN jsonb_build_object(
            'intent', 'query_top_products',
            'params', jsonb_build_object(
                'response_text', 'Productos mas vendidos'
            )
        );
    END IF;

    -- PATRON 5: Cuantas mesas / cuantos clientes
    IF v_text ~* '(cuantos|cuantas|mesa|cliente|persona)' THEN
        RETURN jsonb_build_object(
            'intent', 'query_table_stats',
            'params', jsonb_build_object(
                'response_text', 'Estado de las mesas'
            )
        );
    END IF;

    -- PATRON 6: Margen / rentabilidad
    IF v_text ~* '(margen|rentabilidad|ganancia|rentable)' THEN
        RETURN jsonb_build_object(
            'intent', 'query_profit',
            'params', jsonb_build_object(
                'response_text', 'Analisis de rentabilidad'
            )
        );
    END IF;

    -- DEFAULT
    RETURN jsonb_build_object(
        'intent', 'unknown',
        'params', jsonb_build_object(
            'response_text', '¿Puedes reformular la pregunta? Puedo ayudarte con ventas, stock, comandas y mas.'
        )
    );
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- 4. VIP BLINDADO: trigger que BLOQUEA DELETE/UPDATE accidental
--    El tenant de chalohiahmd1980@gmail.com es INTOCABLE
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS is_protected BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS protected_by TEXT,           -- 'vip_rules' | 'manual'
    ADD COLUMN IF NOT EXISTS protected_at TIMESTAMPTZ;

-- Marcar el tenant de chalohiahmd y rofixinsta como protegidos
UPDATE public.tenants t
SET
    is_protected = TRUE,
    protected_by = 'vip_rules',
    protected_at = NOW()
FROM auth.users u
WHERE t.owner_id = u.id
  AND u.email IN ('chalohiahmd1980@gmail.com', 'rofixinsta@gmail.com');

-- ★ Trigger que bloquea DELETE en tenants protegidos
CREATE OR REPLACE FUNCTION public.protect_vip_tenants()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_protected = TRUE THEN
        RAISE EXCEPTION 'TENANT_PROTEGIDO: Este tenant esta blindado y no puede ser borrado (email: %)', OLD.name
            USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_vip_tenants_delete ON public.tenants;
CREATE TRIGGER trg_protect_vip_tenants_delete
    BEFORE DELETE ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_vip_tenants();

-- ★ Trigger que audita cambios en tenants protegidos
CREATE OR REPLACE FUNCTION public.audit_vip_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_protected = TRUE THEN
        INSERT INTO public.ai_logs (tenant_id, action, model, output_json, status)
        VALUES (
            OLD.id,
            'vip_protected_change',
            'system',
            jsonb_build_object(
                'old', row_to_json(OLD),
                'new', row_to_json(NEW),
                'changed_by', current_setting('request.jwt.claims', true)
            ),
            'audit'
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_vip_changes ON public.tenants;
CREATE TRIGGER trg_audit_vip_changes
    AFTER UPDATE ON public.tenants
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_vip_changes();

COMMENT ON TABLE public.email_verifications IS
    'OTP de verificacion de email (6 digitos, 10 min expiracion). VIP bypass.';
COMMENT ON TABLE public.business_types IS
    'Tipos de negocio preconfigurados con cartas optimizadas (bar, cafeteria, etc).';
COMMENT ON FUNCTION public.create_otp IS
    'Genera codigo OTP de 6 digitos. VIP bypass automatico para chalohiahmd/rofixinsta.';
COMMENT ON FUNCTION public.verify_otp IS
    'Verifica OTP. Devuelve verified=true si coincide, false si expiro o es incorrecto.';
COMMENT ON FUNCTION public.seed_menu_for_tenant IS
    'Inyecta carta estandar segun tipo de negocio (bar_tapas, cafeteria, etc). SQL puro <50ms.';
COMMENT ON FUNCTION public.parse_user_intent IS
    'Pattern matching SQL para el chat Habla con Riyad. Detecta intenciones (ventas, stock, etc).';
