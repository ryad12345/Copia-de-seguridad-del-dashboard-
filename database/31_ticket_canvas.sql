-- =====================================================================
-- MOZONA TPV — database/31_ticket_canvas.sql (v3.4.5)
-- =====================================================================
-- Editor visual tipo Canva para tickets térmicos.
-- Almacena el layout (posiciones, textos, logo) como JSONB.
-- =====================================================================

ALTER TABLE public.tenant_settings
    ADD COLUMN IF NOT EXISTS ticket_logo_url TEXT,
    ADD COLUMN IF NOT EXISTS ticket_layout_json JSONB;

-- ★ Estructura esperada de ticket_layout_json:
-- [
--   {
--     "id": "elem-1",
--     "type": "logo|image",       // imagen
--     "x": 10, "y": 5,            // % desde top-left
--     "w": 80, "h": 20,           // % del ancho del ticket
--     "src": "data:image/png;base64,...",
--     "visible": true
--   },
--   {
--     "id": "elem-2",
--     "type": "text",
--     "x": 0, "y": 30, "w": 100, "h": 8,
--     "content": "MI RESTAURANTE",
--     "fontSize": 14,
--     "fontWeight": 900,
--     "align": "center",
--     "visible": true
--   },
--   {
--     "id": "elem-3",
--     "type": "block_info",       // bloque con ID/Fecha/Hora/Mesa
--     "x": 0, "y": 45, "w": 100, "h": 18,
--     "fields": ["id","date","time","table"],
--     "visible": true
--   },
--   {
--     "id": "elem-4",
--     "type": "block_lines",      // líneas de productos
--     "x": 0, "y": 65, "w": 100, "h": 25,
--     "visible": true
--   },
--   {
--     "id": "elem-5",
--     "type": "block_totals",     // subtotal/IVA/total
--     "x": 0, "y": 90, "w": 100, "h": 6,
--     "visible": true
--   },
--   {
--     "id": "elem-6",
--     "type": "text",
--     "x": 0, "y": 96, "w": 100, "h": 4,
--     "content": "Gracias por su visita!",
--     "fontSize": 9,
--     "align": "center",
--     "visible": true
--   }
-- ]

COMMENT ON COLUMN public.tenant_settings.ticket_logo_url IS 'URL o data-URI del logo del tenant (max 200KB)';
COMMENT ON COLUMN public.tenant_settings.ticket_layout_json IS 'Array de elementos del ticket con posiciones x,y,w,h en %';
