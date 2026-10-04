# extract-menu — Edge Function (Gemini 1.5 Flash)

Extrae cartas de restaurantes a JSON estructurado con Gemini 1.5 Flash
(tier gratuito de Google AI Studio).

## Variables de entorno

| Variable         | Obligatorio | Default              | Descripción                                      |
|------------------|-------------|----------------------|--------------------------------------------------|
| `GEMINI_API_KEY` | ✅          | —                    | API key de https://aistudio.google.com/app/apikey |
| `GEMINI_MODEL`   | ❌          | `gemini-1.5-flash`   | Modelo a usar (1.5-flash / 1.5-flash-8b / 2.0)   |

## Despliegue

```bash
# 1) Instala supabase CLI si no lo tienes
brew install supabase/tap/supabase     # macOS
# o: scoop install supabase           # Windows
# o: https://github.com/supabase/cli#install-the-cli

# 2) Login
supabase login

# 3) Link al proyecto
supabase link --project-ref hcqkpokodrqimkulporw

# 4) Configura el secret (NO usar VITE_, debe ser solo server)
supabase secrets set GEMINI_API_KEY=AIzaSy...

# 5) Despliega la función
supabase functions deploy extract-menu --no-verify-jwt
```

## Probar

```bash
curl -i -X POST \
  https://hcqkpokodrqimkulporw.supabase.co/functions/v1/extract-menu \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -d '{
    "fileName": "carta.jpg",
    "mimeType": "image/jpeg",
    "base64":  "/9j/4AAQ..."
  }'
```

Respuesta esperada:
```json
{
  "items": [
    { "category": "Entrantes", "name": "Ensalada Rusa", "description": "Patata y atún", "price": 9.00, "tax_rate": 10 }
  ],
  "count": 1,
  "model": "gemini-1.5-flash"
}
```

## Costes

| Tier         | RPM         | TPD        | Precio                       |
|--------------|-------------|------------|------------------------------|
| Free         | 15          | 1.500      | Gratis hasta el límite       |
| Tier 1       | 2.000       | 50.000.000 | $0.075 / 1M tokens entrada   |

`gemini-1.5-flash` es ideal para este caso (OCR + JSON estructurado).
Caben ~3.000 cartas completas al mes gratis.

## Fallback offline

Si la función falla o no está desplegada, el frontend cae automáticamente
a **tesseract.js** local (OCR en el navegador, español).
Si tampoco se detecta texto, se devuelven 5 productos de muestra.
