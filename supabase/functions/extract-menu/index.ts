// =====================================================================
// MOZONA TPV — Edge Function: extract-menu (v4.0.8-secure)
// =====================================================================
// Recibe un archivo (imagen o PDF) en base64 y devuelve un JSON
// estructurado con categorías, platos, descripciones y precios.
//
// Modelo: gemini-1.5-flash (tier gratuito de Google AI Studio / Vertex).
// Variables de entorno necesarias:
//   GEMINI_API_KEY    — API key de Google AI Studio (https://aistudio.google.com)
//   GEMINI_MODEL      — opcional, default: "gemini-1.5-flash"
//
// Deploy:
//   supabase functions deploy extract-menu
//   supabase secrets set GEMINI_API_KEY=AIza...
//
// HARDENING v4.0.8-secure:
//   - Requiere JWT de usuario verificado server-side (antes cualquiera podía
//     consumir la cuota de Gemini del proyecto y subir imágenes arbitrarias).
//   - CORS restringido a allowlist (nunca `*`).
//   - Los errores de Gemini NO se devuelven al cliente (solo se registran).
// =====================================================================

// @ts-nocheck  — Deno runtime, los tipos los trae el host
// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, verifyUser, clientIp, rateLimit } from "../_shared/security.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL   = Deno.env.get("GEMINI_MODEL")   ?? "gemini-1.5-flash";

const SYSTEM_PROMPT = `Eres un asistente que extrae cartas de restaurantes a JSON estricto.
Devuelve SOLO un JSON (sin markdown, sin backticks) con la forma:
{
  "items": [
    { "category": "<categoría>", "name": "<plato>", "description": "<descripción breve o vacío>", "price": <número con punto decimal>, "tax_rate": 10 }
  ]
}
Reglas:
  - Idioma: español.  Detecta categorías del menú (Entrantes, Principales, Postres, Bebidas, etc.).
  - Precios SIEMPRE como número decimal con punto (ej. 8.50).  Sin €, sin comas, sin texto.
  - tax_rate: 10 para restauración, 21 para bebidas alcohólicas; default 10.
  - Si un plato no tiene descripción, devuelve "".
  - No inventes platos.  Si la imagen no es una carta, devuelve items: [].`;

serve(async (req) => {
    // Preflight CORS
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders(req, "POST, OPTIONS") });
    }

    const jsonError = (status: number, message: string): Response =>
        new Response(
            JSON.stringify({ error: message, items: [] }),
            { status, headers: { ...corsHeaders(req, "POST, OPTIONS"), "Content-Type": "application/json" } },
        );

    if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: corsHeaders(req, "POST, OPTIONS") });
    }

    try {
        // ★ Autenticación obligatoria (JWT verificado server-side).
        const verified = await verifyUser(req, SUPABASE_URL, SERVICE_KEY);
        if (!verified.ok) {
            return jsonError(verified.status, "No autorizado");
        }

        // Rate limiting por usuario/IP (extracción es costosa).
        if (!rateLimit(`extract-menu:${verified.user.id || clientIp(req)}`, 10, 60_000)) {
            return jsonError(429, "Demasiadas peticiones");
        }

        if (!GEMINI_API_KEY) {
            return jsonError(500, "Servicio de extracción no configurado");
        }

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") {
            return jsonError(400, "Body inválido");
        }
        const { base64, mimeType, fileName } = body as {
            base64?: string; mimeType?: string; fileName?: string;
        };
        if (!base64 || !mimeType) {
            return jsonError(400, "Faltan campos base64/mimeType");
        }

        // Limpia el prefijo data: si viene
        const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "");

        // Llamada a Gemini ----------------------------------------------------
        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent` +
            `?key=${GEMINI_API_KEY}`;

        const payload = {
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{
                role: "user",
                parts: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: cleanBase64,
                        },
                    },
                    {
                        text: `Archivo: ${fileName ?? "carta"}.  Extrae todos los productos.`,
                    },
                ],
            }],
            generationConfig: {
                temperature: 0.2,
                topP: 0.8,
                maxOutputTokens: 4096,
                responseMimeType: "application/json",
            },
        };

        const resp = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        if (!resp.ok) {
            const errTxt = await resp.text();
            // ★ Sólo al log del servidor; nunca al cliente.
            console.error("[extract-menu] Gemini error:", resp.status, errTxt.slice(0, 300));
            return jsonError(502, "El servicio de extracción no está disponible");
        }

        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!text) {
            return jsonError(502, "El servicio de extracción devolvió una respuesta vacía");
        }

        // Parsear JSON (a veces viene envuelto en ```json ... ```)
        const cleanText = text.replace(/^```(?:json)?\s*/i, "")
                              .replace(/```\s*$/, "")
                              .trim();
        let parsed: { items: any[] };
        try {
            parsed = JSON.parse(cleanText);
        } catch (e) {
            console.error("[extract-menu] JSON parse error:", cleanText.slice(0, 200));
            return jsonError(502, "El servicio de extracción devolvió un resultado inválido");
        }

        // Sanear items --------------------------------------------------------
        const allowedTax = new Set([10, 21]);
        const items = (parsed.items ?? [])
            .map((it: any) => ({
                category:    String(it.category ?? "Carta").slice(0, 50),
                name:        String(it.name ?? "").slice(0, 100),
                description: String(it.description ?? "").slice(0, 250),
                price:       Number.isFinite(+it.price) ? +Number(it.price).toFixed(2) : 0,
                tax_rate:    allowedTax.has(+it.tax_rate) ? +it.tax_rate : 10,
            }))
            .filter((it: any) => it.name && it.price > 0 && it.price < 1000);

        return new Response(
            JSON.stringify({ items, count: items.length, model: GEMINI_MODEL }),
            { headers: { ...corsHeaders(req, "POST, OPTIONS"), "Content-Type": "application/json" } },
        );
    } catch (e) {
        console.error("[extract-menu] error:", e instanceof Error ? e.message : String(e));
        return jsonError(500, "Error interno del servicio");
    }
});
