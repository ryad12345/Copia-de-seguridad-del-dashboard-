// =====================================================================
// MOZONA TPV — Shared Edge Function security helpers
// =====================================================================
// Centraliza:
//   - Allowlist de CORS (configurable por env, con defaults de la app)
//   - Comparación en tiempo constante de secretos
//   - Verificación de JWT de usuario contra Supabase Auth (GoTrue)
//   - Rate limiting en memoria (best-effort, por isolate)
//   - Sanitización de mensajes de error (no filtrar SQL/stack/secrets)
//
// Nota: el rate limiting en memoria es best-effort (por isolate de Deno).
//       Para límites fuertes por identidad hace falta una tabla/Redis; ver
//       notas de riesgo residual en el resumen del cambio.
// =====================================================================

export const APP_ORIGINS = [
  "https://mozonatpv.site",
  "https://www.mozonatpv.site",
];

export const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
];

function envOrigins(): string[] {
  const raw = Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Set de orígenes permitidos: env override + defaults de la app + dev. */
export function allowedOrigins(): Set<string> {
  return new Set<string>([...envOrigins(), ...APP_ORIGINS, ...DEV_ORIGINS]);
}

/**
 * Cabeceras CORS restringidas a allowlist. Si el Origin no está permitido,
 * se responde con el origen primario de la app (nunca `*`).
 */
export function corsHeaders(
  req: Request,
  methods = "POST, OPTIONS",
): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = allowedOrigins();
  const allow = allowed.has(origin) ? origin : APP_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-application-name, x-application-version",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

/** Cabeceras CORS para endpoints genuinamente públicos (sin credenciales). */
export function publicCorsHeaders(
  req: Request,
  methods = "POST, OPTIONS",
): Record<string, string> {
  return { ...corsHeaders(req, methods), "Access-Control-Allow-Credentials": "false" };
}

/**
 * Comparación en tiempo constante de dos secretos.
 * Devuelve false si alguno está vacío (evita el bypass de "secret" == "").
 */
export function timingSafeEqual(a: unknown, b: unknown): boolean {
  const sa = typeof a === "string" ? a : "";
  const sb = typeof b === "string" ? b : "";
  if (sa.length === 0 || sb.length === 0) return false;
  const ab = new TextEncoder().encode(sa);
  const bb = new TextEncoder().encode(sb);
  // La longitud no es secreta; el contenido sí.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export interface VerifiedUser {
  id: string;
  email: string;
  tenantId: string | null;
  raw: Record<string, unknown>;
}

function claimTenant(user: Record<string, any>): string | null {
  const meta = (user?.app_metadata ?? {}) as Record<string, any>;
  const umeta = (user?.user_metadata ?? {}) as Record<string, any>;
  return (
    meta.tenant_id ??
    meta.tenantId ??
    umeta.tenant_id ??
    umeta.tenantId ??
    null
  );
}

/**
 * Verifica un JWT de usuario contra /auth/v1/user.
 * No confía en cabeceras de identidad controladas por el cliente.
 */
export async function verifyUser(
  req: Request,
  supabaseUrl: string,
  apikey: string,
): Promise<
  { ok: true; user: VerifiedUser } | { ok: false; status: number; error: string }
> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { ok: false, status: 401, error: "Authorization Bearer token requerido" };
  }
  if (!supabaseUrl || !apikey) {
    return { ok: false, status: 500, error: "Servicio de autenticación no configurado" };
  }
  let resp: Response;
  try {
    resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${token}` },
    });
  } catch (_) {
    return { ok: false, status: 502, error: "No se pudo validar el token" };
  }
  if (!resp.ok) {
    return { ok: false, status: 401, error: "Token inválido o expirado" };
  }
  const user = await resp.json().catch(() => null) as Record<string, any> | null;
  if (!user?.id) {
    return { ok: false, status: 401, error: "Token inválido" };
  }
  return {
    ok: true,
    user: {
      id: String(user.id),
      email: String(user.email || "").toLowerCase(),
      tenantId: claimTenant(user),
      raw: user,
    },
  };
}

/** Emails de administrador permitidos (env override + default). */
export function adminEmails(): string[] {
  const env = (Deno.env.get("ADMIN_EMAILS") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...env, "rofixinsta@gmail.com"]));
}

export function isAdmin(email: string): boolean {
  return adminEmails().includes((email || "").toLowerCase());
}

/** Respuesta JSON con cabeceras CORS restringidas. */
export function json(
  req: Request,
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", ...extraHeaders },
  });
}

/** Respuesta genérica sin filtrar detalles internos. */
export function safeError(e: unknown): string {
  return "Error interno del servicio";
}

// ─── Rate limiting en memoria (best-effort por isolate) ────────────────────

const buckets = new Map<string, number[]>();

/**
 * Ventana deslizante simple. Devuelve true si la acción está permitida.
 * @param key identidad (usuario/ip/email)
 * @param limit máximos eventos permitidos en `windowMs`
 * @param windowMs tamaño de la ventana en ms
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  // Limpieza oportunista para evitar crecimiento ilimitado
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
  return true;
}

/** Identidad del cliente para rate limiting (IP de proxy o desconocida). */
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
