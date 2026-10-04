// =====================================================================
// MOZONA TPV — firebase.ts
// =====================================================================
// Inicialización CONDICIONAL de Firebase.
//
// Si las variables VITE_FIREBASE_* están configuradas, se inicializa
// y se exporta `db` (Firestore) y `notifier` (webhook helper).
// Si NO están, `db = null` y `FIREBASE_CONFIGURED = false`. El chatLeads
// devolverá error claro al usuario y el UI muestra CTA WhatsApp.
//
// IMPORTANTE PARA VERCEL BUILD:
//   Vite nunca falla el build por variables de entorno faltantes —
//   `import.meta.env.VITE_FIREBASE_*` simplemente es `undefined` en
//   runtime si no están definidas. Por eso firebase.ts compila
//   perfectamente tanto con como sin las credenciales.
//
// VARIABLES DE ENTORNO REQUERIDAS (en .env.production / Vercel)
//   VITE_FIREBASE_API_KEY
//   VITE_FIREBASE_AUTH_DOMAIN
//   VITE_FIREBASE_PROJECT_ID
//   VITE_FIREBASE_STORAGE_BUCKET
//   VITE_FIREBASE_MESSAGING_SENDER_ID
//   VITE_FIREBASE_APP_ID
//   VITE_FIREBASE_MEASUREMENT_ID     (opcional, Analytics)
//
// VARIABLES DE WEBHOOK PARA NOTIFICACIONES
//   VITE_NOTIFY_WEBHOOK_URL          (Resend API endpoint, Zapier, n8n, etc.)
//   VITE_NOTIFY_TO_EMAIL             (a quién llega la alerta)
// =====================================================================

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

export const FIREBASE_CONFIGURED: boolean = !!(import.meta.env.VITE_FIREBASE_API_KEY
    && import.meta.env.VITE_FIREBASE_PROJECT_ID);

let app: FirebaseApp | null = null;
let db:  Firestore   | null = null;

if (FIREBASE_CONFIGURED) {
    try {
        const config = {
            apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId:             import.meta.env.VITE_FIREBASE_APP_ID,
            measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
        };
        app = initializeApp(config);
        db  = getFirestore(app);
        console.log("[firebase] inicializado OK · project:", config.projectId);
    } catch (e) {
        console.error("[firebase] error al inicializar, fallback a Supabase:", e);
        app = null;
        db  = null;
    }
} else {
    console.log("[firebase] NO configurado, los leads iran a Supabase (leads_onboarding)");
}

export { app, db };

/** ★ Webhook de notificación de nuevo lead.
 *  Si VITE_NOTIFY_WEBHOOK_URL está definida, hace POST con los datos.
 *  Si no, no-op silencioso. */
export interface NewLeadNotification {
    leadId:         string;
    restaurantName: string;
    userEmail:      string;
    selectedPlan:   string;
    trialEndsAt:    string;
    source:         string;
}

export async function notifyNewLead(lead: NewLeadNotification): Promise<{ ok: boolean; error?: string }> {
    const url = import.meta.env.VITE_NOTIFY_WEBHOOK_URL as string | undefined;
    if (!url) {
        // Silencioso: no hay webhook configurado
        return { ok: true };
    }
    try {
        const to = import.meta.env.VITE_NOTIFY_TO_EMAIL as string | undefined;
        const now = new Date().toLocaleString("es-ES", { dateStyle: "long", timeStyle: "short" });
        // ★ v1.9.45: asunto y plantilla según spec final del cliente
        const subject = `🚀 Nueva Solicitud de Contratación (Prueba 7 días) - ${lead.restaurantName || "(sin nombre)"}`;
        const html = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto">
                <div style="background:linear-gradient(135deg,#2563eb 0%,#7c3aed 100%);padding:20px 24px;border-radius:12px 12px 0 0">
                    <h1 style="margin:0;color:white;font-size:20px">🚀 Nueva Solicitud de Contratación</h1>
                    <p style="margin:6px 0 0 0;color:#dbeafe;font-size:13px">Prueba 7 días · ${escapeHtml(lead.restaurantName || "(sin nombre)")}</p>
                </div>
                <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
                    <h2 style="margin:0 0 16px 0;font-size:16px;color:#0f172a">Datos del contrato</h2>
                    <table style="border-collapse:collapse;width:100%;font-size:13.5px">
                        <tr><td style="padding:8px 0;color:#64748b;width:160px">Nombre del Negocio / Local</td><td style="padding:8px 0;font-weight:600">${escapeHtml(lead.restaurantName || "—")}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b">Plan elegido</td><td style="padding:8px 0;font-weight:600">${escapeHtml(planLabel(lead.selectedPlan))}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b">Email facilitado por el cliente</td><td style="padding:8px 0;font-weight:600"><a href="mailto:${escapeHtml(lead.userEmail || "")}" style="color:#2563eb">${escapeHtml(lead.userEmail || "—")}</a></td></tr>
                        <tr><td style="padding:8px 0;color:#64748b">Fecha y hora exacta de la solicitud</td><td style="padding:8px 0;font-weight:600">${escapeHtml(now)}</td></tr>
                        <tr><td style="padding:8px 0;color:#64748b">Lead ID (Firestore)</td><td style="padding:8px 0;font-family:monospace;font-size:11px">${escapeHtml(lead.leadId || "—")}</td></tr>
                    </table>
                    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
                        Solicitud capturada por Riyad, asistente IA de MOZONA TPV. Email interno · Confidencial.
                    </div>
                </div>
            </div>
        `;
        const text = `🚀 Nueva Solicitud de Contratación (Prueba 7 días) - ${lead.restaurantName || "(sin nombre)"}\n\n`
                   + `Nombre del Negocio / Local: ${lead.restaurantName || "—"}\n`
                   + `Plan elegido: ${planLabel(lead.selectedPlan)}\n`
                   + `Email facilitado por el cliente: ${lead.userEmail || "—"}\n`
                   + `Fecha y hora exacta de la solicitud: ${now}\n`
                   + `Lead ID (Firestore): ${lead.leadId || "—"}\n\n`
                   + `Solicitud capturada por Riyad, asistente IA de MOZONA TPV. Email interno · Confidencial.`;

        // Soporta Resend API y cualquier webhook genérico con JSON {to, subject, html/text}
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                to, subject, html, text,
                // ★ v1.9.48: from actualizado al dominio oficial
                from: "MOZONA TPV <noreply@mozonatpv.site>",
                lead,
            }),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            console.warn("[notify] webhook status", res.status, body.slice(0, 200));
            return { ok: false, error: `HTTP ${res.status}` };
        }
        console.log("[notify] webhook OK");
        return { ok: true };
    } catch (e: any) {
        console.warn("[notify] error:", e?.message ?? e);
        return { ok: false, error: e?.message ?? "Error" };
    }
}

function planLabel(plan: string | undefined): string {
    const map: Record<string, string> = {
        basic:        "Plan Plus (Básico) — 30€/mes",
        professional: "Plan Pro (Profesional) — 50€/mes",
        premium:      "Plan Premium — 99€/mes",
        trial:        "Trial 7 días",
    };
    return (plan && map[plan]) || "—";
}

function escapeHtml(s: string): string {
    return String(s).replace(/[<>&"']/g, c =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c] ?? c)
    );
}
